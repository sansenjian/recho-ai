<script setup lang="ts">
import type { PublicAnnouncement } from '../composables/useAnnouncementPopup'

defineProps<{
  announcement: PublicAnnouncement
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <div class="announcement-overlay" @click.self="emit('close')">
    <section class="announcement-dialog" role="dialog" aria-modal="true" aria-labelledby="announcement-title">
      <header class="announcement-header">
        <div>
          <span>公告</span>
          <h2 id="announcement-title">{{ announcement.title }}</h2>
        </div>
        <button type="button" title="关闭" aria-label="关闭公告" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>
      <p class="announcement-body">{{ announcement.body }}</p>
      <footer class="announcement-actions">
        <button type="button" @click="emit('close')">知道了</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.announcement-overlay {
  position: fixed;
  inset: 0;
  z-index: 260;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.38);
  backdrop-filter: blur(8px);
}

.announcement-dialog {
  width: min(480px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-raised);
  box-shadow: var(--shadow-md);
}

.announcement-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 14px;
}

.announcement-header span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.announcement-header h2 {
  margin: 3px 0 0;
  color: var(--text-primary);
  font-size: 20px;
  line-height: 1.25;
  letter-spacing: 0;
}

.announcement-header button,
.announcement-actions button {
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--text-primary);
  font-weight: 800;
  cursor: pointer;
}

.announcement-header button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--text-secondary);
}

.announcement-header button:hover,
.announcement-actions button:hover {
  border-color: var(--border-strong);
  background: var(--hover-bg);
}

.announcement-body {
  margin: 0;
  color: var(--text-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.7;
}

.announcement-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
}

.announcement-actions button {
  min-height: 36px;
  padding: 0 14px;
}

@media (max-width: 768px) {
  .announcement-overlay {
    align-items: end;
    padding: 12px;
  }

  .announcement-dialog {
    width: 100%;
    max-height: calc(100vh - 24px);
    padding: 16px;
  }

  .announcement-header button,
  .announcement-actions button {
    min-height: 44px;
  }

  .announcement-header button {
    width: 44px;
    height: 44px;
  }
}
</style>
