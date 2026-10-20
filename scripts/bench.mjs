import { lint, summarize } from "../src/lint.mjs"

const counts = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0)
const sizes = counts.length ? counts : [100, 500, 1000]

function makeSkill(index) {
  const id = `skill-${index}`
  return {
    id,
    form: "dir",
    file: `/tmp/skills/${id}/SKILL.md`,
    source: { dir: "/tmp/skills", kind: "bench", scope: "project", order: 1 },
    order: 1,
    displayName: `Skill ${index}`,
    description: `Do task number ${index % 50} carefully and report the result with enough detail for a reviewer`,
    autoinvoke: undefined,
    disabled: undefined,
    hidden: false,
    advertised: true,
    body: "body ".repeat(20),
    bodyTokens: 25,
    bytes: 200,
    descriptionTokens: 20,
    hash: `hash-${index % 97}`,
    mtime: Date.now(),
  }
}

for (const size of sizes) {
  const skills = Array.from({ length: size }, (_, i) => makeSkill(i))
  const started = performance.now()
  const findings = lint(skills)
  const elapsed = performance.now() - started
  const summary = summarize(skills)
  console.log(
    `n=${size}  lint=${elapsed.toFixed(1)}ms  findings=${findings.length}  advertisedTokens=${summary.advertisedTokens}`,
  )
}
