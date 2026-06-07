import { createRouter, createWebHistory } from 'vue-router'

export type RouteWorkspace = 'image' | 'chat' | 'works'

function firstQueryValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: (to) => {
        const type = firstQueryValue(to.query.type)
        if (to.query.token_hash || type === 'email') {
          return { path: '/auth/confirm', query: to.query, hash: to.hash }
        }
        if (to.query.code) {
          return { path: '/auth/callback', query: to.query, hash: to.hash }
        }
        return '/image'
      },
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
      path: '/admin',
      component: () => import('../views/AdminView.vue'),
    },
    {
      path: '/auth/confirm',
      component: () => import('../components/AuthConfirmView.vue'),
    },
    {
      path: '/auth/callback',
      component: () => import('../components/AuthCallbackView.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/image',
    },
  ],
})
