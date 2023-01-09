import { warn } from '../util/warn'
import { extend } from '../util/misc'
import { handleRouteEntered } from '../util/route'

export default {
  name: 'RouterView',
  functional: true,
  props: {
    name: {
      type: String,
      default: 'default'
    }
  },
  render (_, { props, children, parent, data }) {
    // used by devtools to display a router-view badge
    data.routerView = true

    // directly use parent context's createElement() function
    // so that components rendered by router-view can resolve named slots
    // ??? 为何不能用renderContext._c
    const h = parent.$createElement
    
    const name = props.name
    const route = parent.$route
    const cache = parent._routerViewCache || (parent._routerViewCache = {})

    // determine current view depth, also check to see if the tree
    // has been toggled inactive but kept-alive.
    // depth为router-view的路由深度
    let depth = 0
    // inactive字段标记是否被keep-alive组件包裹且在失活的组件下
    let inactive = false
    while (parent && parent._routerRoot !== parent) {
      const vnodeData = parent.$vnode ? parent.$vnode.data : {}
      // 判断是否祖先组件是否为router-view组件
      if (vnodeData.routerView) {
        depth++
      }
      if (vnodeData.keepAlive && parent._directInactive && parent._inactive) {
        inactive = true
      }
      parent = parent.$parent
    }
    data.routerViewDepth = depth

    // render previous view if the tree is inactive and kept-alive
    // 如果在失活组件下，则渲染旧节点
    if (inactive) {
      const cachedData = cache[name]
      const cachedComponent = cachedData && cachedData.component
      if (cachedComponent) {
        // #2301
        // pass props
        if (cachedData.configProps) {
          fillPropsinData(cachedComponent, data, cachedData.route, cachedData.configProps)
        }
        return h(cachedComponent, data, children)
      } else {
        // render previous empty view
        return h()
      }
    }

    // 获取对应的组件
    const matched = route.matched[depth]
    const component = matched && matched.components[name]

    // render empty node if no matched route or no config component
    // 没有定义对应的组件则渲染空节点
    if (!matched || !component) {
      cache[name] = null
      return h()
    }

    // cache component
    // 缓存组件的构造函数
    cache[name] = { component }

    // attach instance registration hook
    // this will be called in the instance's injected lifecycle hooks
    // 在data上挂载registerRouteInstance字段，在执行beforeCreate生命周期钩子中调用
    // 作用是将实例放在_route.matched.depth.instances.xxx字段上
    data.registerRouteInstance = (vm, val) => {
      // val could be undefined for unregistration
      const current = matched.instances[name]
      if (
        (val && current !== vm) ||
        (!val && current === vm)
      ) {
        matched.instances[name] = val
      }
    }

    // also register instance in prepatch hook
    // in case the same component instance is reused across different routes
    // 挂载prepatch钩子，同样是将实例放在_route.matched.depth.instances.xxx字段上
    ;(data.hook || (data.hook = {})).prepatch = (_, vnode) => {
      matched.instances[name] = vnode.componentInstance
    }

    // register instance in init hook
    // in case kept-alive component be actived when routes changed
    // 挂载init钩子，同样是将实例放在_route.matched.depth.instances.xxx字段上
    // 用于在keepalive组件下切换路由时，挂载实例
    data.hook.init = (vnode) => {
      if (vnode.data.keepAlive &&
        vnode.componentInstance &&
        vnode.componentInstance !== matched.instances[name]
      ) {
        matched.instances[name] = vnode.componentInstance
      }

      // if the route transition has already been confirmed then we weren't
      // able to call the cbs during confirmation as the component was not
      // registered yet, so we call it here.
      // 调用路由中所有的enteredCbs
      handleRouteEntered(route)
    }

    // configProps为路由记录上的props
    const configProps = matched.props && matched.props[name]
    // save route and configProps in cache
    // 在catch[name]上添加route和configProps字段
    if (configProps) {
      extend( cache[name], { route, configProps })
      // 将设置中的props放入节点data.props和data.attrs中
      fillPropsinData(component, data, route, configProps)
    }

    return h(component, data, children)
  }
}

// 将设置中的props放入节点data.props和data.attrs中
function fillPropsinData (component, data, route, configProps) {
  // 将props解析为一个对象形式
  let propsToPass = data.props = resolveProps(route, configProps)
  if (propsToPass) {
    // clone to prevent mutation
    propsToPass = data.props = extend({}, propsToPass)
    // pass non-declared props as attrs
    const attrs = data.attrs = data.attrs || {}
    // 将没有声明为props的多余属性设置为attrs
    for (const key in propsToPass) {
      if (!component.props || !(key in component.props)) {
        attrs[key] = propsToPass[key]
        delete propsToPass[key]
      }
    }
  }
}

// 将props规范化
function resolveProps (route, config) {
  switch (typeof config) {
    case 'undefined':
      return
    case 'object':
      return config
    case 'function':
      return config(route)
    case 'boolean':
      return config ? route.params : undefined
    default:
      if (process.env.NODE_ENV !== 'production') {
        warn(
          false,
          `props in "${route.path}" is a ${typeof config}, ` +
          `expecting an object, function or boolean.`
        )
      }
  }
}
