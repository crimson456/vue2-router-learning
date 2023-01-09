vue2 router 源码学习笔记



src
|----index                              主入口
|----install                            插件下载调用的方法
|----router                             VueRouter的定义
|----create-matcher                     匹配器的定义
|----create-route-map                   路由记录的创建
|----entries                            不同模块化的入口
|  |----cjs                                   cjs入口
|  |----esm                                   esm入口
|
|----history                            history对象
|  |----base                                  History类
|  |----hash                                  HashHistory类
|  |----html5                                 HTML5History类
|  |----abstract                              服务端渲染使用的AbstractHistory类
|
|----components                         组件定义
|  |----link                                  router-link组件定义
|  |----view                                  router-view组件定义
|
|----util                               工具方法
|  |----async                                 按顺序执行守卫的工具函数
|  |----dom                                   inBrowser常量定义
|  |----errors                                错误处理相关
|  |----location                              将传入的路径解析为一个location对象
|  |----misc                                  extend工具函数实现
|  |----params                                填充路径的params参数
|  |----path                                  拼接相对路径、解析路径参数、清除路径中连续/的工具函数
|  |----push-state                            操作history API 的函数封装
|  |----query                                 解析路由的query参数
|  |----resolve-components                    组件相关工具函数，主要是从一个路由记录数组中取出所有组件和同步执行异步组件
|  |----route                                 路由创建
|  |----scroll                                处理页面滚动
|  |----state-key                             为每一个页面定义一个对象，保存页面滚动位置
|  |----warn                                  抛出错误和警告
|
|----composables                        似乎是组合式api的不兼容提示
|  |----globals                               
|  |----guards                                
|  |----index                                 
|  |----useLink                               
|  |----utils                                 







