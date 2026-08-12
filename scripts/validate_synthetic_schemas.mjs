#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

async function readJson(relativePath) {
  const payload = await readFile(resolve(repositoryRoot, relativePath), 'utf8')
  return JSON.parse(payload)
}

const contracts = [
  {
    data: 'public/data/synthetic-workers.json',
    schema: 'data/schemas/synthetic-worker.schema.json',
  },
  {
    data: 'public/data/synthetic-households.json',
    schema: 'data/schemas/synthetic-household.schema.json',
  },
]

const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)

let failed = false
for (const contract of contracts) {
  const [schema, data] = await Promise.all([
    readJson(contract.schema),
    readJson(contract.data),
  ])
  const validate = ajv.compile(schema)
  if (!validate(data)) {
    failed = true
    process.stderr.write(
      `${contract.data} does not satisfy ${contract.schema}\n${ajv.errorsText(validate.errors, { separator: '\n' })}\n`,
    )
    continue
  }
  process.stdout.write(`${contract.data}\tvalid\n`)
}

if (failed) process.exit(1)
