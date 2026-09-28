const { parentPort } = require('node:worker_threads')
const Ajv = require('ajv')

const ajv = new Ajv({ strict: false, allErrors: false, validateFormats: false })
const validators = new Map()

parentPort.on('message', ({ id, revision, schema, arguments: args, compileOnly }) => {
  try {
    let validate = validators.get(revision)
    if (!validate) {
      validate = ajv.compile(schema)
      if ('$async' in validate) throw new Error('Asynchronous tool schemas are not supported')
      if (validators.size >= 128) validators.clear()
      validators.set(revision, validate)
    }
    parentPort.postMessage({ id, ok: true, valid: compileOnly || !!validate(args) })
  } catch {
    // Schemas and their errors come from the server. Keep their text out of IPC.
    parentPort.postMessage({ id, ok: false })
  }
})
