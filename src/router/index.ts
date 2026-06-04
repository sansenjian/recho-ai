import { createRouter, createWebHistory } from 'vue-router'

export type RouteWorkspace = 'image' | 'chat' | 'works'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/image',
    },
    {
      path: '/image',
      component: () => import('../views/AppShell.vue'),
      meta: { workspace: 'image' satisfies RouteWorkspace },
    },
    {
      path: '/chat',
      component: () => import('../views/AppShell.vue'),
      meta: { workspace: 'chat' satisfies RouteWorkspace },
    },
    {
      path: '/works',
      component: () => import('../views/AppShell.vue'),
      meta: { workspace: 'works' satisfies RouteWorkspace },
    },
    {
      path: '/auth/confirm',
      component: () => import('../components/AuthConfirmView.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/image',
    },
  ],
})
