import { definePlugin } from '@halo-dev/ui-shared'
import { IconPlug } from '@halo-dev/components'
import { markRaw } from 'vue'

export default definePlugin({
  components: {},
  routes: [
    {
      parentName: 'Root',
      route: {
        path: '/halo-cli',
        name: 'HaloCli',
        component: () => import(/* webpackChunkName: "HomeView" */ './views/HomeView.vue'),
        meta: {
          title: 'Halo CLI',
          searchable: true,
          permissions: ['plugin:halo-cli:download:view'],
          menu: {
            name: 'Halo CLI',
            group: 'tool',
            icon: markRaw(IconPlug),
            priority: 20,
          },
        },
      },
    },
  ],
  extensionPoints: {},
})
