import { readFile } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

class SkillLoader {
  constructor() {
    this.skills = new Map()
  }

  async load() {
    try {
      const indexPath = resolve(__dirname, 'index.json')
      const raw = await readFile(indexPath, 'utf-8')
      const list = JSON.parse(raw)
      this.skills.clear()
      for (const skill of list) {
        if (skill.name) {
          this.skills.set(skill.name, skill)
        }
      }
      console.log(`Skills loaded: ${this.skills.size} skill(s)`)
    } catch (err) {
      console.error(`Skills load failed: ${err.message}`)
    }
  }

  get(name) {
    return this.skills.get(name) || null
  }

  getAll() {
    return Array.from(this.skills.values()).map(s => ({
      name: s.name,
      description: s.description,
      icon: s.icon,
    }))
  }

  has(name) {
    return this.skills.has(name)
  }
}

export const skillLoader = new SkillLoader()
