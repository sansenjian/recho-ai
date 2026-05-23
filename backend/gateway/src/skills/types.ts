export interface SkillDefinition {
  name: string
  description: string
  icon: string
  system_prompt?: string
  tools?: string[]
}

export interface SkillSummary {
  name: string
  description: string
  icon: string
}
