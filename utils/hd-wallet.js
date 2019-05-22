// const hdWallet = require('hd-wallet')
// const {
//   WorkerDiscovery, BitcoreBlockchain, AccountLoadStatus,
//   UtxoInfo: BaseUtxoInfo, AccountInfo: BaseAccountInfo,
// } = hdWallet

// const xpubWasmFile = require('hd-wallet/lib/fastxpub/fastxpub.wasm')
// const XpubWorker = require('hd-wallet/lib/fastxpub/fastxpub')
// const SocketWorker = require('hd-wallet/lib/socketio-worker/inside')
// const DiscoveryWorker = require('hd-wallet/lib/discovery/worker/inside')

// // setting up workers
// const socketWorkerFactory = () => new SocketWorker()
// const discoveryWorkerFactory = () => new DiscoveryWorker()

// const xpubWasmFilePromise = fetch('hd-wallet/lib/fastxpub/fastxpub.wasm')
//   .then((response) => response.ok ? response.arrayBuffer() : Promise.reject('failed to load fastxpub.wasm'))

// function discoverAccount(xpub, network, onUpdate) {
//   const endPoints = ['https://btc.faa.st','https://btc1.trezor.io','https://insight.bitpay.com, ']
//   const discovery = new WorkerDiscovery(discoveryWorkerFactory, new XpubWorker(), xpubWasmFilePromise, new BitcoreBlockchain(endPoints, socketWorkerFactory))
//   return Promise.resolve()
//     .then(() => {
//       const segwit = 'p2sh'
//       const cashAddress = false // To maintain compatability with bitcoinjs-lib don't use bchaddr format
//       const process = discovery.discoverAccount(null, xpub, network, segwit, cashAddress, 20)
//       if (onUpdate) {
//         process.stream.values.attach(onUpdate)
//       }
//       return process.ending
//         .then((result) => ({
//           ...result,
//           utxos: result.utxos.map((utxo) => ({
//             ...utxo,
//             confirmations: utxo.height ? result.lastBlock.height - utxo.height : 0,
//           })),
//         }))
//         .catch((e) => {
//           console.error('error discovering account:', e)
//           throw e
//         })
//     })
// }

// module.exports = {
//   discoverAccount
// }

var bip32utils = require('bip32-utils')
var Blockchain = require('cb-blockr')

function discoverAccount (node) {
  var blockchain = new Blockchain('mainnet')
  var chain = bip32utils.Chain(node)
  var GAP_LIMIT = 20

  bip32utils.discovery(chain, GAP_LIMIT, function(addresses, callback) {
    blockchain.addresses.summary(addresses, function(err, results) {
      if (err) return callback(err)
   
      var areUsed = results.map(function(result) {
        return result.totalReceived > 0
      })
   
      callback(undefined, areUsed)
    })
  }, function(err, used, checked) {
    if (err) throw err
   
    console.log('Discovered at most ' + used + ' used addresses')
    console.log('Checked ' + checked + ' addresses')
    console.log('With at least ' + (checked - used) + ' unused addresses')
   
    // throw away ALL unused addresses AFTER the last unused address
    var unused = checked - used
    for (var i = 1; i < unused; ++i) chain.pop()
   
    // remember used !== total, chain may have started at a k-index > 0
    console.log('Total number of addresses (after prune): ', chain.addresses.length)
  })
}

module.exports = {
  discoverAccount
}