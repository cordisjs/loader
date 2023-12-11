import { Context, EffectScope, ForkScope } from 'cordis'
import { Dict, isNullable, valueMap } from 'cosmokit'
import { constants, promises as fs } from 'fs'
import { interpolate } from './utils'
import * as yaml from 'js-yaml'
import * as path from 'path'

declare module 'cordis' {
  interface Events {
    'config'(): void
    'exit'(signal: NodeJS.Signals): Promise<void>
    'loader/update'(this: Context, type: string, entry: Entry): void
  }

  interface Context {
    loader: Loader
  }

  interface EnvData {
    startTime?: number
  }

  // Theoretically, these properties will only appear on `ForkScope`.
  // We define them directly on `EffectScope` for typing convenience.
  interface EffectScope {
    id?: string
  }
}

export interface Entry {
  id: string
  name: string
  config: any
  when?: any
}

export function unwrapExports(module: any) {
  return module?.default || module
}

const kUpdate = Symbol('update')

const writable = {
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
}

interface State {
  entry: Entry
  fork?: ForkScope
}

export namespace Loader {
  export interface Options {
    name: string
    mutable?: boolean
  }
}

export abstract class Loader<T extends Loader.Options = Loader.Options> {
  static readonly exitCode = 51

  // process
  public baseDir = process.cwd()
  public envData = process.env.KOISHI_SHARED
    ? JSON.parse(process.env.KOISHI_SHARED)
    : { startTime: Date.now() }

  public params = {
    env: process.env,
  }

  public app: Context
  public config!: Entry[]
  public suspend = false
  public writable = false
  public mime!: string
  public filename!: string
  public names = new Set<string>()
  public states: Dict<State> = Object.create(null)

  private tasks = new Set<Promise<any>>()
  private store = new WeakMap<any, string>()

  abstract import(name: string): Promise<any>
  abstract fullReload(code?: number): void

  constructor(public options: T) {
    this.app = new Context()
  }

  async init(filename?: string) {
    if (filename) {
      filename = path.resolve(this.baseDir, filename)
      const stats = await fs.stat(filename)
      if (stats.isFile()) {
        this.filename = filename
        this.baseDir = path.dirname(filename)
        const extname = path.extname(filename)
        this.mime = writable[extname]
        // eslint-disable-next-line n/no-deprecated-api
        if (!(extname in { ...writable, ...require.extensions })) {
          throw new Error(`extension "${extname}" not supported`)
        }
      } else {
        this.baseDir = filename
        await this.findConfig()
      }
    } else {
      await this.findConfig()
    }
    if (this.mime) {
      try {
        await fs.access(this.filename, constants.W_OK)
        this.writable = true
      } catch {}
    }
  }

  private async findConfig() {
    const files = await fs.readdir(this.baseDir)
    // eslint-disable-next-line n/no-deprecated-api
    for (const extname in { ...writable, ...require.extensions }) {
      const filename = this.options.name + extname
      if (files.includes(filename)) {
        this.mime = writable[extname]
        this.filename = path.resolve(this.baseDir, filename)
        return
      }
    }
    throw new Error('config file not found')
  }

  async readConfig() {
    if (this.mime === 'application/yaml') {
      this.config = yaml.load(await fs.readFile(this.filename, 'utf8')) as any
    } else if (this.mime === 'application/json') {
      // we do not use require here because it will pollute require.cache
      this.config = JSON.parse(await fs.readFile(this.filename, 'utf8')) as any
    } else {
      const module = require(this.filename)
      this.config = module.default || module
    }
    return this.config
  }

  async writeConfig(silent = false) {
    this.suspend = true
    if (!this.writable) {
      throw new Error(`cannot overwrite readonly config`)
    }
    if (this.mime === 'application/yaml') {
      await fs.writeFile(this.filename, yaml.dump(this.config))
    } else if (this.mime === 'application/json') {
      await fs.writeFile(this.filename, JSON.stringify(this.config, null, 2))
    }
    if (!silent) this.app.emit('config')
  }

  interpolate(source: any) {
    if (typeof source === 'string') {
      return interpolate(source, this.params, /\$\{\{(.+?)\}\}/g)
    } else if (!source || typeof source !== 'object') {
      return source
    } else if (Array.isArray(source)) {
      return source.map(item => this.interpolate(item))
    } else {
      return valueMap(source, item => this.interpolate(item))
    }
  }

  async resolve(name: string) {
    const task = this.import(name)
    this.tasks.add(task)
    task.then(() => this.tasks.delete(task))
    const plugin = unwrapExports(await task)
    if (plugin) this.store.set(this.app.registry.resolve(plugin), name)
    return plugin
  }

  keyFor(plugin: any) {
    return this.store.get(this.app.registry.resolve(plugin))
  }

  replace(oldKey: any, newKey: any) {
    oldKey = this.app.registry.resolve(oldKey)
    newKey = this.app.registry.resolve(newKey)
    const name = this.store.get(oldKey)
    if (!name) return
    this.store.set(newKey, name)
    this.store.delete(oldKey)
  }

  isTruthyLike(expr: any) {
    if (isNullable(expr)) return true
    return !!this.interpolate(`\${{ ${expr} }}`)
  }

  async reload(parent: Context, entry: Entry) {
    let state = this.states[entry.id]
    if (state?.fork) {
      if (!this.isTruthyLike(entry.when)) {
        this.unload(parent, entry)
        return
      }
      state.fork[kUpdate] = true
      state.fork.update(entry.config)
    } else {
      if (!this.isTruthyLike(entry.when)) return
      this.app.emit(parent, 'loader/update', 'apply', entry)
      const plugin = await this.resolve(entry.name)
      if (!plugin) return
      const ctx = parent.extend()
      state = {
        entry,
        fork: ctx.plugin(plugin, this.interpolate(entry.config)),
      }
      state.fork!.id = entry.id
    }
  }

  unload(parent: Context, entry: Entry) {
    const state = this.states[entry.id]
    if (state?.fork) {
      this.app.emit(parent, 'loader/update', 'unload', entry)
      state.fork.dispose()
    }
  }

  paths(scope: EffectScope): string[] {
    // root scope
    if (scope === scope.parent.scope) return []

    // runtime scope
    if (scope.runtime === scope) {
      return ([] as string[]).concat(...scope.runtime.children.map(child => this.paths(child)))
    }

    if (scope.id) return [scope.id]
    return this.paths(scope.parent.scope)
  }

  async start() {
    this.app.provide('loader', this, true)
    this.app.provide('baseDir', this.baseDir, true)
    for (const entry of this.config) {
      this.reload(this.app, entry)
    }

    this.app.on('dispose', () => {
      this.fullReload()
    })

    this.app.on('internal/update', (fork) => {
      const state = this.states[fork.id!]
      if (!state) return
      this.app.emit(fork.parent, 'loader/update', 'reload', state.entry)
    })

    this.app.on('internal/before-update', (fork, config) => {
      if (fork[kUpdate]) return delete fork[kUpdate]
      if (!fork.id) return
      const { schema } = fork.runtime
      fork.parent.scope.config = schema ? schema.simplify(config) : config
      this.writeConfig()
    })

    while (this.tasks.size) {
      await Promise.all(this.tasks)
    }

    return this.app.start()
  }
}
