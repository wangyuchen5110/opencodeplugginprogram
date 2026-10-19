#!/usr/bin/env node
import { main } from "../src/cli.mjs"

main(process.argv.slice(2)).catch((err) => {
  console.error(`skills-doctor 出错: ${err?.message ?? err}`)
  process.exit(2)
})
