import { readFile } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { SkillDefinition, SkillSummary } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

class SkillLoader {
  private skills: Map<string, SkillDefinition> = new Map()

  async load(): Promise<void> {
    try {
      // Look for index.json relative to the gateway src directory
      const indexPath = resolve(__dirname, '..', '..', 'skills', 'index.json')
      const raw = await readFile(indexPath, 'utf-8')
      const list: SkillDefinition[] = JSON.parse(raw)
      this.skills.clear()
      for (const skill of list) {
        if (skill.name) {
          this.skills.set(skill.name, skill)
        }
      }
      console.log(`Skills loaded: ${this.skills.size} skill(s)`)
    } catch (err: any) {
      console.error(`Skills load failed: ${err.message}`)
    }
  }

  get(name: string): SkillDefinition | null {
    return this.skills.get(name) || null
  }

  getAll(): SkillSummary[] {
    return Array.from(this.skills.values()).map(s => ({
      name: s.name,
      description: s.description,
      icon: s.icon,
    }))
  }

  has(name: string): boolean {
    return this.skills.has(name)
  }

  validateTools(availableToolNames: string[]): string[] {
    const available = new Set(availableToolNames)
    const missing: string[] = []
    for (const skill of this.skills.values()) {
      for (const toolName of skill.tools ?? []) {
        if (!available.has(toolName)) {
          missing.push(`${skill.name}:${toolName}`)
        }
      }
    }
    if (missing.length > 0) {
      console.warn(`Skill tool validation warning: missing tool(s): ${missing.join(', ')}`)
    }
    return missing
  }
}

export const skillLoader = new SkillLoader()
