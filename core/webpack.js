const Compiler = require('./compiler')

const webpack = (configOpts) => {
  // 1.初始化参数阶段
  const mergeOpts = _mergeOptions(configOpts)

  // 2.新建编译器实例
  const compiler = new Compiler(mergeOpts)

   // 加载插件, 将编译器传递给每个插件的 apply 方法
   // - 日常我们编写webpack plugin时本质上就是操作compiler对象从而影响打包结果进行。

   // - 没错！关于webpack插件本质上就是通过发布订阅的模式，通过compiler上监听事件。然后再打包编译过程中触发监听的事件从而添加一定的逻辑影响打包结果。
   
   /* - 每个插件的apply方法上通过 tap 在编译准备阶段(也就是调用webpack()函数时) 订阅对应的 hook 事件
        当编译执行到一定阶段时,发布对应的事件,通知订阅者执行回调，从而达到在编译阶段的不同生命周期，去触发对应的plugin
   */
   _loadPlugin(configOpts.plugins, compiler)

  return compiler
}

/**
 * 
 * @param {Object} config 配置参数 
 * @returns 配置参数和命令行参数 合并后的配置
 */
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
