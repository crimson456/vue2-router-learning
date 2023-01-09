import View from './components/view'
import Link from './components/link'

export let _Vue

export function install (Vue) {
  // 防止重复挂载插件
  if (install.installed && _Vue === Vue) return
  install.installed = true

  _Vue = Vue

  const isDef = v => v !== undefined

  const registerInstance = (vm, callVal) => {
    let i = vm.$options._parentVnode
    if (isDef(i) && isDef(i = i.data) && isDef(i = i.registerRouteInstance)) {
      i(vm, callVal)
    }
  }

  Vue.mixin({
    beforeCreate () {
      // 在根组件上挂载_routerRoot、_router、_route
      // 在组件上挂载_routerRoot
      if (isDef(this.$options.router)) {
        // _routerRoot为挂载router的根组件
        this._routerRoot = this
        this._router = this.$options.router
        // 初始化路由，跳转到初始路由位置，并开始监听地址变化
        this._router.init(this)
        // 定义响应式路由，当路由发生改变时，更新所有依赖，主要是router-view组件的渲染watcher回收集此依赖，路由更新的时候所有router-view组件更新
        Vue.util.defineReactive(this, '_route', this._router.history.current)
      } else {
        this._routerRoot = (this.$parent && this.$parent._routerRoot) || this
      }
      registerInstance(this, this)
    },
    destroyed () {
      registerInstance(this)
    }
  })

  Object.defineProperty(Vue.prototype, '$router', {
    get () { return this._routerRoot._router }
  })

  Object.defineProperty(Vue.prototype, '$route', {
    get () { return this._routerRoot._route }
  })

  Vue.component('RouterView', View)
  Vue.component('RouterLink', Link)

  const strats = Vue.config.optionMergeStrategies
  // use the same hook merging strategy for route hooks
  strats.beforeRouteEnter = strats.beforeRouteLeave = strats.beforeRouteUpdate = strats.created
}
