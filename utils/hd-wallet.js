const {
  WorkerDiscovery, BitcoreBlockchain, AccountLoadStatus,
  UtxoInfo: BaseUtxoInfo, AccountInfo: BaseAccountInfo,
} = require('hd-wallet')
const TinyWorker = require('tiny-worker')
const fetch = require('node-fetch')
const fs = require('fs')

let socketWorkerFactory
let discoveryWorkerFactory
let xpubWorker
socketWorkerFactory = () => new TinyWorker('./node_modules/hd-wallet/lib/socketio-worker/inside.js')
discoveryWorkerFactory = () => new TinyWorker(() => {
  const requireHack = eval('req' + 'uire');
  requireHack('@babel/register')({ cache: true });
  requireHack('hd-wallet/lib/discovery/worker/inside/index.js');
})
xpubWorker = new TinyWorker('./node_modules/hd-wallet/lib/fastxpub/fastxpub.js')

const xpubFilePromise = require('util').promisify(fs.readFile)('./node_modules/hd-wallet/lib/fastxpub/fastxpub.wasm')
  .then(buf => Array.from(buf))

function discoverAccount(xpub, network, onUpdate) {
  const endPoints = ['https://btc.faa.st','https://btc1.trezor.io','https://insight.bitpay.com']
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