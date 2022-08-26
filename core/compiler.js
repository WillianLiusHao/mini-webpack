// Compiler类进行核心编译实现

const { SyncHook } = require('tapable') // SyncHook：一个类似eventBus的东西
const { toUnixPath, tryExtensions, getSourceCode } = require('./utils');
const path = require('path')
const fs = require('fs')

const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generator = require('@babel/generator').default;
const t = require('@babel/types')

class Compiler {
  constructor(opts) {
    this.opts = opts
    this.rootPath = this.opts.context || toUnixPath(process.cwd())
    // 外部可以通过 compiler.run.tap(eventName, cb) 注册事件
    // 通过 this.hook.run.call() 触发所有 tap 注册的事件
    // 此处仅实现 webpack 常用的 3个钩子函数
    this.hooks = {
      // 开始编译时候的钩子
      run: new SyncHook(),
      // 输出 asset 到 output 目录之前执行 (写入文件之前)
      emit: new SyncHook(),
      // 在 compilation 完成时执行 全部完成编译执行
      done: new SyncHook()
    }
    // 保存所有入口模块对象
    this.entries = new Set()
    // 保存所有依赖模块对象
    this.depModules = new Set()
    // 所有的代码块对象
    this.chunks = new Set()
    // 存放本次产出的文件对象
    this.assets = new Map()
    // 存放本次编译所有产出的文件名
    this.files = new Set()
  }
  /**
   * 启动编译
   * @param {Function} cb
   */ 
  run(cb) {
    // 执行挂载在run钩子上的plugin
    this.hooks.run.call()
    // 获取入口配置对象
    const entry = this.getEntry()
    // 编译
    this.buildEntryModule(entry)
    // 生成文件
    this.exportFile(cb)
  }
  getEntry() {
    let entry = Object.create(null);
    const { entry: optionsEntry } = this.opts;
    if (typeof optionsEntry === 'string') {
      entry['main'] = optionsEntry;
    } else {
      entry = optionsEntry;
    }
    // 将entry变成绝对路径
    Object.keys(entry).forEach((key) => {
      const value = entry[key];
      if (!path.isAbsolute(value)) {
        entry[key] = toUnixPath(path.join(this.rootPath, value));
      }
    })
    return entry;
  }
  /**
   * 根据入口构建模块
   * @param {string[]} entry 
   */
  buildEntryModule(entry) {
    Object.keys(entry).forEach((entryName) => {
      const entryPath = entry[entryName];
      const entryObj = this.buildModule(entryName, entryPath); // 这里是重点！！！
      this.entries.add(entryObj);
      this.buildChunk(entryName, entryObj)
    })
    // console.log('----------entries----------');
    // console.log(this.entries)
    // console.log('----------depModules----------');
    // console.log(this.depModules)
    // console.log('----------chunks----------');
    // console.log(this.chunks)
  }
  /* 核心编译功能：读取文件，编译模块
    1. fs 读取模块源代码
    2. 调用匹配的 loader 处理代码
    3. babel 分析处理上述代码，进行编译(调整 require 语句)
    4. 对require 的模块递归使用 buildModule 方法进行编译
    5. 返回编译后的对象
  */ 
  buildModule(moduleName, modulePath) {
    // 1. fs 读取模块源代码
    this.moduleCode = fs.readFileSync(modulePath, 'utf-8')
    // 2. 调用匹配的 loader 处理代码
    this.handleLoader(modulePath)    
    // 3. babel 分析处理上述代码，进行编译(调整 require 语句)
    const module = this.handleWebpackCompiler(moduleName, modulePath)
    // 4. 返回构建完成的 module
    return module
  }
  handleLoader(path) {
    const matchLoaders = []
    const rules = this.opts.module.rules;
    // 1. 获取所有匹配的loader
    rules.forEach(loader => {
      const testRule = loader.test
      if((testRule.test(path))) {
        // 仅考虑loader { test:/\.js$/, loader:'babel-loader' }, { test:/\.js$/g, use:['babel-loader'] }
        if(loader.loader) {
          matchLoaders.push(loader.loader)
        } else {
          matchLoaders.push(...loader.use);
        }
      }
    })
    // 2. 倒序执行loader传入源代码， 源码中是使用了 compose 函数
    for (let i = matchLoaders.length - 1; i >= 0; i--) {
      // 获取loader的模式
      // - 直接传入函数
      // - 外部传入绝对路径
      let loaderFn = null
      if(typeof matchLoaders[i] === 'string') {
        loaderFn = require(matchLoaders[i]);
      } else if (matchLoaders[i] instanceof Function) {
        loaderFn = matchLoaders[i]
      }
      this.moduleCode = loaderFn(this.moduleCode);
    }
  }
  /**
   * ！！！模块编译函数：编译模块代码、生成模块对象
   * @param {string} moduleName: 模块名 => 模块所属入口文件
   * @param {string} modulePath: 模块相对于根的路径
   * @returns {
   *    id: string
   *    dependencies: Set
   *    name: string[]
   *    _source: Code
   * }
   */
  handleWebpackCompiler(moduleName, modulePath) {
    // 将当前模块相对于项目启动根目录计算出相对路径 作为模块ID
    const moduleId = toUnixPath('./' + path.relative(this.rootPath, modulePath))
    // 创建模块对象
    const module = {
      id: moduleId,
      dependencies: new Set(), // 该模块所依赖模块绝对路径地址
      name: [moduleName], // 该模块所属的入口文件
    }

    const ast = parser.parse(this.moduleCode, {sourceType: 'module'})
    traverse(ast, {
      CallExpression: (nodePath) => {
        const node = nodePath.node
        // 处理引入模块,生成引入模块 module 对象
        if (node.callee.name === 'require') {
          const requirePath = node.arguments[0].value;
          const moduleDir = path.dirname(modulePath);
          // 引入模块绝对路径 = 当前模块文件夹路径 + require模块的相对路径
          const absolutePath = tryExtensions(
            path.join(moduleDir, requirePath),
            this.opts.resolve.extensions,
            moduleName,
            moduleDir
          )
          const moduleId = toUnixPath('./' + path.relative(this.rootPath, absolutePath))

          node.callee = t.identifier('__webpack_require__');
          // 修改源代码中require语句引入的模块 全部修改变为相对于根路径来处理
          node.arguments = [t.stringLiteral(moduleId)];
          // 为当前模块添加require语句造成的依赖(内容为相对于根路径的模块ID)
          module.dependencies.add(moduleId);
        }
      }
    })
    const { code } = generator(ast)
    // const { cloneDeep } = require('../../utils')
    //                     ↓
    // const { cloneDeep } = __webpack_require__('./utils')  
    module._source = code;

    // dfs 处理依赖模块，把所有文件的依赖模块存到全局
    module.dependencies.forEach(dependency => {
      const depModule = this.buildModule(moduleName, dependency)
      /* 处理一个模块被多个文件应用导致多次加入全局依赖 */
      const existDepIds = [...this.depModules].map(dep => dep.id)
      if(!existDepIds.includes(depModule.id)) {
        // 不存在则添加
        this.depModules.add(depModule)
      } else {
        // 存在则增加这个模块的入口
        this.depModules.forEach(x => {
          if(x.id === depModule.id) {
            x.name.push(moduleName)
          }
        })
      }
    })
    return module
  }
  /**
   * 根据入口文件个数构建chunk
   * @param {string} entryName: 模块名 => 模块所属入口文件
   * @param {Object} entryObj: entry编译后的模块对象
   */
  buildChunk(entryName, entryObj) {
    const chunk = {
      name: entryName, // 每一个入口文件作为一个chunk
      entryModule: entryObj,
      modules: Array.from(this.depModules).filter((i) =>
        i.name.includes(entryName)
      ), // 寻找与当前entry有关的所有module
    }
    this.chunks.add(chunk)
  }
  /**
    1. 获取output配置，根据chunks的内容为this.assets中添加需要打包生成的文件名和文件内容。
    2. 将文件写入磁盘前调用plugin的emit钩子函数。
    3. 判断output.path文件夹是否存在，如果不存在，则通过fs新建这个文件夹。
    4. 将本次打包生成的所有文件名(this.assets的key值组成的数组)存放进入files中去。
    5. 循环this.assets，将文件依次写入对应的磁盘中去。
    6. 所有打包流程结束，触发webpack插件的done钩子。
    7. 同时为NodeJs Webpack APi呼应，调用run方法中外部传入的callback传入两个参数
   */
  exportFile(callback) {
    // step1
    const outPutConfig = this.opts.output
    this.chunks.forEach(chunk => {
      const fileName = outPutConfig.filename.replace('[name]', chunk.name)
      this.assets.set(fileName, getSourceCode(chunk))
    })
    // step2
    this.hooks.emit.call()
    // step3
    if(!fs.existsSync(outPutConfig.path)) {
      fs.mkdirSync(outPutConfig.path)
    }
    // step4
    this.files = [...this.assets.keys()]
    // step5
    for(let [name, code] of this.assets) {
      fs.writeFileSync(path.join(outPutConfig.path, name), code)
    }
    // step6
    this.hooks.done.call()
    // step7
    callback(null, {
      toJson: () => {
        return {
          entries: this.entries,
          modules: this.modules,
          files: this.files,
          chunks: this.chunks,
          assets: this.assets,
        };
      },
    })
  }
}

module.exports = Compiler
