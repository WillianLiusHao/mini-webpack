
/*
 *webpack 实现流程
 */

const config = require('../example/webpack.config');
const webpack = require('./webpack');

const compiler = webpack(config);

// 调用run方法进行打包
compiler.run((err, stats) => {
  if (err) {
    console.log(err, 'err');
  }
  // ...
})
