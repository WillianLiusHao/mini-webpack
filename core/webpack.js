const Compiler = require('./compiler')

const webpack = (configOpts) => {
  // 1.初始化参数阶段
  const mergeOpts = _mergeOptions(configOpts)

  // 2.编译阶段
  const compiler = new Compiler(mergeOpts)

   // 加载插件, 将编译器传递给每个插件的 apply 方法
   // - 日常我们编写webpack plugin时本质上就是操作compiler对象从而影响打包结果进行。

   // - 没错！关于webpack插件本质上就是通过发布订阅的模式，通过compiler上监听事件。然后再打包编译过程中触发监听的事件从而添加一定的逻辑影响打包结果。
   
   /* - 在每个插件的apply方法上通过tap在编译准备阶段(也就是调用webpack()函数时)进行订阅对应的事件
        当我们的编译执行到一定阶段时发布对应的事件告诉订阅者去执行监听的事件，从而达到在编译阶段的不同生命周期内去触发对应的plugin
   */
   _loadPlugin(configOpts.plugins, compiler)

  return compiler
}

const _mergeOptions = (config) => {
  const shellOpts = process.argv.slice(2).reduce((res, curArg) => {
    const [key, val] = curArg.split('=')
    if(key && val) {
      const keyName = key.slice(2)
      res[keyName] = val
    }
    return res
  }, {})
  return {
    ...config,
    ...shellOpts
  }
}

const _loadPlugin = (plugins, compiler) => {
  if(plugins && Array.isArray(plugins)) {
    plugins.forEach(plugin => {
      plugin.apply(compiler)
    })
  }
}

module.exports = webpack
