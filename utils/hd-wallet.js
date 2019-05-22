const hdWallet = require('hd-wallet')
const fetch = require('node-fetch')
const {
  WorkerDiscovery, BitcoreBlockchain, AccountLoadStatus,
  UtxoInfo: BaseUtxoInfo, AccountInfo: BaseAccountInfo,
} = hdWallet

// const xpubWasmFile = require('hd-wallet/lib/fastxpub/fastxpub.wasm')
const XpubWorker = require('hd-wallet/lib/fastxpub/fastxpub.js')
const SocketWorker = require('hd-wallet/lib/socketio-worker/inside.js')
const DiscoveryWorker = require('hd-wallet/lib/discovery/worker/inside.js')

// setting up workers
const socketWorkerFactory = () => new SocketWorker()
const discoveryWorkerFactory = () => new DiscoveryWorker()

const xpubWasmFilePromise = fetch('hd-wallet/lib/fastxpub/fastxpub.wasm')
  .then((response) => response.ok ? response.arrayBuffer() : Promise.reject('failed to load fastxpub.wasm'))

function discoverAccount(xpub, network, onUpdate) {
  const endPoints = ['https://btc.faa.st','https://btc1.trezor.io','https://insight.bitpay.com, ']
  const discovery = new WorkerDiscovery(discoveryWorkerFactory, new XpubWorker(), xpubWasmFilePromise, new BitcoreBlockchain(endPoints, socketWorkerFactory))
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