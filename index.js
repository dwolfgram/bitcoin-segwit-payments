const axios = require('axios').default
const hdWallet = require('./utils/hd-wallet').default
const bitcoin = require('bitcoinjs-lib')
const request = require('request')
const sb = require('satoshi-bitcoin')
const MIN_RELAY_FEE = 1000
const DEFAULT_SAT_PER_BYTE = 50

function SegwitDepositUtils (options) {
  if (!(this instanceof SegwitDepositUtils)) return new SegwitDepositUtils(options)
  let self = this
  self.options = Object.assign({}, options || {})
  if (!self.options.insightUrl) {
    self.options.insightUrl = 'https://insight.bitpay.com/api/'
    console.log('WARN: Using default bitcoin block explorer. It is highly suggested you set one yourself!', self.options.insightUrl)
  }

  if (!self.options.feePerKb) {
    self.options.feePerByte = DEFAULT_SAT_PER_BYTE
  }
  if (!self.options.network || (self.options.network === 'mainnet')) {
    self.options.network = bitcoin.networks.mainnet
    if (!self.options.backupBroadcastUrl) {
      self.options.backupBroadcastUrl = 'https://btc.faa.st/insight-api/'
    }
  } else if (self.options.network === 'testnet') {
    self.options.network = bitcoin.networks.testnet
    if (!self.options.backupBroadcastUrl) {
      self.options.backupBroadcastUrl = 'https://tbtc.faa.st/insight-api/'
    }
  } else {
    return new Error('Invalid network provided ' + self.options.network)
  }
  // if (!self.options.password) throw new Error('SegwitDepositUtils: password required')
  return self
}

SegwitDepositUtils.prototype.getAddress = function(node, network) {
  const wif = node.toWIF()
  const keyPair = bitcoin.ECPair.fromWIF(wif, network)
  let { address } = bitcoin.payments.p2sh({
    redeem: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey })
  })
  return address
}

SegwitDepositUtils.prototype.getBalance = function(address, options = {}, done) {
  let self = this
  let url = self.options.insightUrl + 'addr/' + address
  request.get({ json: true, url: url }, (err, response, body) => {
    if (!err && response.statusCode !== 200) {
      return done('Unable to get balance from ' + url)
    } else {
      done(null, { balance: body.balance, unconfirmedBalance: body.unconfirmedBalance })
    }
  })
}

SegwitDepositUtils.prototype.sortUtxos = function(utxoList) {
  const matureList = []
  const immatureList = []
  utxoList.forEach((utxo) => {
    if (utxo.confirmations >= 6) {
      matureList.push(utxo)
    } else {
      immatureList.push(utxo)
    }
  })
  matureList.sort((a, b) => a.value - b.value) // Ascending order by value
  immatureList.sort((a, b) => b.confirmations - a.confirmations) // Descending order by confirmations
  return matureList.concat(immatureList)
}

SegwitDepositUtils.prototype.discoverAccount = async function(xpub, network) {
  try {
    const account = await hdWallet.discoverAccount(xpub, network)
    console.log(account)
    return account
  } catch (err) {
    console.log(err)
  }
}

SegwitDepositUtils.prototype.getUTXOs = function(node, network, done) {
  let self = this
  let address = self.getAddress(node, network)
  //console.log('getting utxos:', address)
  let url = self.options.insightUrl + 'addr/' + address + '/utxo'
  request.get({ json: true, url: url }, function(err, response, body) {
    if (!err && response.statusCode !== 200) {
      return done('Unable to get UTXOs from ' + url)
    } else if (body.length === 0) {
      return done('This address has no unspent outputs ' + url)
    } else {
      let cleanUTXOs = []
      body.forEach(function(utxo) {
        delete utxo['confirmations']
        delete utxo['height']
        delete utxo['ts']
        cleanUTXOs.push(utxo)
      })
      if (self.options.network === bitcoin.networks.testnet) {
        console.log('TESTNET ENABLED: Clipping UTXO length to 2 for test purposes')
        cleanUTXOs = cleanUTXOs.slice(0, 2)
      }
      done(null, cleanUTXOs)
    }
  })
}

SegwitDepositUtils.prototype.broadcastTransaction = function(txObject, done, retryUrl, originalResponse) {
  let self = this
  let textBody = '{"rawtx":"' + txObject.signedTx + '"}'
  const broadcastHeaders = {
    'pragma': 'no-cache',
    'cookie': '__cfduid=d365c2b104e8c0e947ad9991de7515e131528318303',
    'origin': 'https://blockexplorer.com',
    'accept-encoding': 'gzip, deflate, br',
    'accept-language': 'en-US,en;q=0.9,fr;q=0.8,es;q=0.7',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/67.0.3396.99 Safari/537.36',
    'content-type': 'application/json;charset=UTF-8',
    'accept': 'application/json, text/plain, */*',
    'cache-control': 'no-cache',
    'authority': 'blockexplorer.com',
    'referer': 'https://blockexplorer.com/tx/send'
  }
  let url
  if (retryUrl) url = retryUrl
  else url = self.options.insightUrl
  var options = {
    url: url + 'tx/send',
    method: 'POST',
    headers: broadcastHeaders,
    body: textBody
  }
  request(options, (error, response, body) => {
    if (!error && response.statusCode === 200) {
      txObject.broadcasted = true
      done(null, txObject.txid)
    } else {
      if (url !== retryUrl) { // First broadcast attempt. Lets try again.
        self.broadcastTransaction(txObject, done, self.options.backupBroadcastUrl, body)
      } else {
        // Second attempt failed
        done('unable to broadcast. Some debug info: ' + body.toString() + ' ---- ' + originalResponse.toString())
      }
    }
  })
}

SegwitDepositUtils.prototype.getTransaction = function(node, network, to, amount, utxo, feePerByte) {
  let self = this
  amount = sb.toSatoshi(amount)
  const txb = new bitcoin.TransactionBuilder(network)
  let totalBalance = 0
  if (utxo.length === 0) {
    return new Error('no UTXOs')
  }
  utxo.forEach(function(spendable) {
    totalBalance += spendable.satoshis
    txb.addInput(spendable.txid, spendable.vout) // alice1 unspent
  })
  if (!feePerByte) feePerByte = self.options.feePerByte
  let txfee = estimateTxFee(feePerByte, utxo.length, 1, true)
  if (txfee < MIN_RELAY_FEE) txfee = MIN_RELAY_FEE
  if ((amount - txfee) > totalBalance) return new Error('Balance too small!' + totalBalance + ' ' + txfee)
  txb.addOutput(to, amount - txfee)
  const wif = node.toWIF()
  const keyPair = bitcoin.ECPair.fromWIF(wif, network)
  const p2sh = bitcoin.payments.p2sh({
    redeem: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey })
  })
  for (let i = 0; i < utxo.length; i++) {
    txb.sign(i,
      keyPair,
      p2sh.redeem.output,
      null, // Null for simple Segwit
      utxo[i].satoshis,
      p2sh.redeem.witness
    )
  }
  return { signedTx: txb.build().toHex(), txid: txb.build().getId() }
}

const getCurrentBTCFeesPerByte = async() => {
  try {
    const fees = await axios.get('https://bitcoinfees.earn.com/api/v1/fees/recommended')
    return fees.data.halfHourFee
  } catch (err) {
    return self.options.feePerByte
  }
}

SegwitDepositUtils.prototype.transaction = function(node, coin, to, amount, options = {}, done) {
  let self = this
  self.getUTXOs(node, coin.network, async (err, utxo) => {
    if (err) return done(err)
    if (!options.feePerByte) {
      const fee = await getCurrentBTCFeesPerByte()
      options.feePerByte = fee
    }
    let signedTx = self.getTransaction(node, coin.network, to, amount, utxo, options.feePerByte)
    self.broadcastTransaction(signedTx, done)
  })
}

SegwitDepositUtils.prototype.getTxHistory = async function(address, done) {
  let self = this
  try {
    const response = await axios.get(`${self.options.insightUrl}txs`, {
      params: {
        address: address
      }
    })
    const history = response.data.txs.map(tx => {
      const { txid, vout = [{}], vin = [{}], fees, valueIn, valueOut, time } = tx
      return ({ 
        txid: txid, 
        sendAddress: vout[0].addresses ? vout[0].addresses[0] : undefined,
        receiveAddress: vin[0].addr,
        fee: fees,
        amountSent: valueIn,
        amountReceived: valueOut,
        date: time
      })
    })
    return done(null, history)
  } catch (err) {
    return done(`unable to fetch transaction history: ${err}`)
  }
}

/**
 * Estimate size of transaction a certain number of inputs and outputs.
 * This function is based off of ledger-wallet-webtool/src/TransactionUtils.js#estimateTransactionSize
 */
const estimateTxSize = function(inputsCount, outputsCount, handleSegwit) {
  var maxNoWitness,
    maxSize,
    maxWitness,
    minNoWitness,
    minSize,
    minWitness,
    varintLength
  if (inputsCount < 0xfd) {
    varintLength = 1
  } else if (inputsCount < 0xffff) {
    varintLength = 3
  } else {
    varintLength = 5
  }
  if (handleSegwit) {
    minNoWitness =
      varintLength + 4 + 2 + 59 * inputsCount + 1 + 31 * outputsCount + 4
    maxNoWitness =
      varintLength + 4 + 2 + 59 * inputsCount + 1 + 33 * outputsCount + 4
    minWitness =
      varintLength +
      4 +
      2 +
      59 * inputsCount +
      1 +
      31 * outputsCount +
      4 +
      106 * inputsCount
    maxWitness =
      varintLength +
      4 +
      2 +
      59 * inputsCount +
      1 +
      33 * outputsCount +
      4 +
      108 * inputsCount
    minSize = (minNoWitness * 3 + minWitness) / 4
    maxSize = (maxNoWitness * 3 + maxWitness) / 4
  } else {
    minSize = varintLength + 4 + 146 * inputsCount + 1 + 31 * outputsCount + 4
    maxSize = varintLength + 4 + 148 * inputsCount + 1 + 33 * outputsCount + 4
  }
  return {
    min: minSize,
    max: maxSize
  }
}

function estimateTxFee (satPerByte, inputsCount, outputsCount, handleSegwit) {
  const { min, max } = estimateTxSize(inputsCount, outputsCount, handleSegwit)
  const mean = Math.ceil((min + max) / 2)
  return mean * satPerByte
}

SegwitDepositUtils.prototype.getFee = async function(node, network, options = {}, done) {
  let self = this
  let feePerByte = options.feePerByte
  if (!feePerByte) {
    const fee = await getCurrentBTCFeesPerByte()
    feePerByte = fee
  }
  self.getUTXOs(node, network, (err, utxo) => {
    if (!err) {
      return done(null, estimateTxFee(feePerByte, utxo.length, 1, true))
    }
    return done(err)
  })
}

module.exports = SegwitDepositUtils