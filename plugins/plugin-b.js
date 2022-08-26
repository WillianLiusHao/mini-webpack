class PluginB {
  apply(compiler) {
    compiler.hooks.done.tap('Plugin B', () => {
      console.log('webpack done hook: PluginB回调执行');
      console.log('--------------------------------');
    });
  }
}

module.exports = PluginB
