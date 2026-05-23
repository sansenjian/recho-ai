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
  width: 292px;
  border-left: 1px solid var(--border);
  background: #fbfbfd;
  padding: 14px;
  overflow-y: auto;
  flex-shrink: 0;
}

.panel-section {
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}

.panel-section:first-child {
  padding-top: 0;
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
  font-weight: 700;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.mode-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.mode-card,
.skill-row {
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: border-color 0.15s, background 0.15s;
}

.mode-card {
  min-height: 74px;
  padding: 8px;
  border-radius: 8px;
}

.mode-card.active,
.skill-row.active {
  border-color: var(--accent);
  background: rgba(99, 102, 241, 0.08);
}

.mode-name,
.skill-name {
  display: block;
  font-size: 13px;
  font-weight: 700;
}

.mode-hint,
.skill-desc,
.tool-state,
.empty-note {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-secondary);
}

.skill-list,
.tool-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.skill-row {
  padding: 8px 10px;
  border-radius: 8px;
}

.clear-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 11px;
}

.tool-row {
  display: grid;
  grid-template-columns: 16px 1fr auto;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.tool-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-family: var(--font-mono);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse 1s ease-in-out infinite;
}

.check {
  color: #16a34a;
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
