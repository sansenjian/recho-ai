<script setup lang="ts">
import type { AgentModeOption } from '../types'
import type { ToolCall } from '../types/tools'

defineProps<{
  modes: AgentModeOption[]
  activeMode: AgentModeOption
  skills: Array<{ name: string; description: string; icon: string }>
  activeSkill: string | null
  activeToolCalls: ToolCall[]
  completedToolCalls: ToolCall[]
}>()

defineEmits<{
  changeMode: [mode: AgentModeOption]
  selectSkill: [name: string | null]
}>()
</script>

<template>
  <aside class="agent-panel">
    <section class="panel-section">
      <div class="section-label">Mode</div>
      <div class="mode-grid">
        <button
          v-for="mode in modes"
          :key="mode.id"
          class="mode-card"
          :class="{ active: mode.id === activeMode.id }"
          @click="$emit('changeMode', mode)"
        >
          <span class="mode-name">{{ mode.label }}</span>
          <span class="mode-hint">{{ mode.hint }}</span>
        </button>
      </div>
    </section>

    <section class="panel-section">
      <div class="section-header">
        <span class="section-label">Skills</span>
        <button v-if="activeSkill" class="clear-btn" @click="$emit('selectSkill', null)">Clear</button>
      </div>
      <div class="skill-list">
        <button
          v-for="skill in skills"
          :key="skill.name"
          class="skill-row"
          :class="{ active: skill.name === activeSkill }"
          @click="$emit('selectSkill', skill.name)"
        >
          <span class="skill-name">/{{ skill.name }}</span>
          <span class="skill-desc">{{ skill.description }}</span>
        </button>
        <div v-if="skills.length === 0" class="empty-note">Gateway skills not loaded</div>
      </div>
    </section>

    <section class="panel-section">
      <div class="section-label">Tool Stream</div>
      <div class="tool-list">
        <div v-for="tool in activeToolCalls" :key="tool.id" class="tool-row running">
          <span class="dot" />
          <span class="tool-name">{{ tool.name }}</span>
          <span class="tool-state">running</span>
        </div>
        <div v-for="tool in completedToolCalls.slice(-4)" :key="tool.id" class="tool-row">
          <span class="check">✓</span>
          <span class="tool-name">{{ tool.name }}</span>
          <span class="tool-state">done</span>
        </div>
        <div v-if="activeToolCalls.length === 0 && completedToolCalls.length === 0" class="empty-note">No tool calls yet</div>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.agent-panel {
  width: 320px;
  box-shadow: -1px 0 0 var(--seed-border, rgba(0,0,0,0.08));
  background: var(--seed-surface, #fff);
  padding: 14px;
  overflow-y: auto;
  flex-shrink: 0;
}

.panel-section {
  padding: 12px 0;
  box-shadow: 0 1px 0 0 var(--seed-border, rgba(0,0,0,0.08));
}

.panel-section:first-child {
  padding-top: 0;
}

.panel-section:last-child {
  box-shadow: none;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.section-label {
  display: block;
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--seed-muted, #666);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.mode-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.mode-card,
.skill-row {
  border: none;
  background: var(--seed-surface-raised, #fafafa);
  color: var(--seed-fg, #171717);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  box-shadow: 0 0 0 1px var(--seed-border, rgba(0,0,0,0.08));
  transition: box-shadow 150ms ease, background 150ms ease;
}

.mode-card {
  min-height: 70px;
  padding: 8px;
  border-radius: var(--seed-radius, 6px);
}

.mode-card.active,
.skill-row.active {
  background: color-mix(in srgb, var(--seed-success, #16a34a) 8%, transparent);
  box-shadow: 0 0 0 1px var(--seed-success, #16a34a);
}

.mode-name,
.skill-name {
  display: block;
  font-size: 13px;
  font-weight: 600;
}

.mode-hint,
.skill-desc,
.tool-state,
.empty-note {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.35;
  color: var(--seed-muted, #666);
}

.skill-list,
.tool-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.skill-row {
  padding: 7px 9px;
  border-radius: var(--seed-radius, 6px);
}

.clear-btn {
  border: none;
  border-radius: 999px;
  background: var(--seed-surface-raised, #fafafa);
  color: var(--seed-muted, #666);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  box-shadow: 0 0 0 1px var(--seed-border, rgba(0,0,0,0.08));
}

.tool-row {
  display: grid;
  grid-template-columns: 16px 1fr auto;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: none;
  border-radius: var(--seed-radius, 6px);
  background: var(--seed-surface-raised, #fafafa);
  box-shadow: 0 0 0 1px var(--seed-border, rgba(0,0,0,0.08));
}

.tool-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-family: var(--seed-mono, 'JetBrains Mono', monospace);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--seed-success, #16a34a);
  animation: pulse 1s ease-in-out infinite;
}

.check {
  color: var(--seed-success, #16a34a);
  font-size: 13px;
}

@keyframes pulse {
  50% { opacity: 0.35; }
}

@media (max-width: 1100px) {
  .agent-panel {
    display: none;
  }
}
</style>
