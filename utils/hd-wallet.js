const {
  WorkerDiscovery, BitcoreBlockchain, AccountLoadStatus,
  UtxoInfo: BaseUtxoInfo, AccountInfo: BaseAccountInfo,
} = require('hd-wallet')
const TinyWorker = require('tiny-worker')
const fetch = require('node-fetch')
const fs = require('fs')

const xpubWasmFile = require('hd-wallet/lib/fastxpub/fastxpub.wasm')
const XpubFile = require('hd-wallet/lib/fastxpub/fastxpub')
const SocketWorker = require('hd-wallet/lib/socketio-worker/inside')
const DiscoveryWorker = require('hd-wallet/lib/discovery/worker/inside')

const socketWorkerFactory = () => new TinyWorker(SocketWorker)
const discoveryWorkerFactory = () => new TinyWorker(DiscoveryWorker)
const xpubWorker = new TinyWorker(XpubFile)
const xpubFilePromise = require('util').promisify(fs.readFile)(xpubWasmFile)
  .then(buf => Array.from(buf))

function discoverAccount(xpub, network, onUpdate) {
  const endPoints = ['https://btc.faa.st','https://btc1.trezor.io','https://insight.bitpay.com, ']
  const blockchain = new BitcoreBlockchain(endPoints, socketWorkerFactory)
  const discovery = new WorkerDiscovery(discoveryWorkerFactory, xpubWorker, xpubFilePromise, blockchain)

  return Promise.resolve()
    .then(() => {
      const segwit = 'p2sh'
      const cashAddress = false // To maintain compatability with bitcoinjs-lib don't use bchaddr format
      const process = discovery.discoverAccount(null, xpub, network, segwit, cashAddress, 20)
      if (onUpdate) {
        process.stream.values.attach(onUpdate)
      }
      return process.ending
        .then((result) => ({
          ...result,
          utxos: result.utxos.map((utxo) => ({
            ...utxo,
            confirmations: utxo.height ? result.lastBlock.height - utxo.height : 0,
          })),
        }))
        .catch((e) => {
          console.error('error discovering account:', e)
          throw e
        })
    })
}

module.exports = {
  discoverAccount
}