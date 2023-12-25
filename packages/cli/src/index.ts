import { ChildProcess, fork } from 'child_process'
import { resolve } from 'path'
import type { Config } from './worker/daemon'
import kleur from 'kleur'
import { Options } from './worker'

type Event = Event.Start | Event.Env | Event.Heartbeat

namespace Event {
  export interface Start {
    type: 'start'
    body: Config
  }

  export interface Env {
    type: 'shared'
    body: string
  }

  export interface Heartbeat {
    type: 'heartbeat'
  }
}

let child: ChildProcess

process.env.KOISHI_SHARED = JSON.stringify({
  startTime: Date.now(),
})

function createWorker(options: Options) {
  let timer: 0 | NodeJS.Timeout | undefined
  let started = false

  child = fork(resolve(__dirname, '../worker'), [], {
    execArgv: options.daemon?.execArgv,
    env: {
      ...process.env,
      CORDIS_LOADER_OPTIONS: JSON.stringify(options),
    },
  })

  child.on('message', (message: Event) => {
    if (message.type === 'start') {
      started = true
      timer = options.daemon?.heartbeatTimeout && setTimeout(() => {
        console.log(kleur.red('daemon: heartbeat timeout'))
        child.kill('SIGKILL')
      }, options.daemon?.heartbeatTimeout)
    } else if (message.type === 'shared') {
      process.env.KOISHI_SHARED = message.body
    } else if (message.type === 'heartbeat') {
      if (timer) timer.refresh()
    }
  })

  // https://nodejs.org/api/process.html#signal-events
  // https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/signal
  const signals: NodeJS.Signals[] = [
    'SIGABRT',
    'SIGBREAK',
    'SIGBUS',
    'SIGFPE',
    'SIGHUP',
    'SIGILL',
    'SIGINT',
    'SIGKILL',
    'SIGSEGV',
    'SIGSTOP',
    'SIGTERM',
  ]

  function shouldExit(code: number, signal: NodeJS.Signals) {
    // start failed
    if (!started) return true

    // exit manually
    if (code === 0) return true
    if (signals.includes(signal)) return true

    // restart manually
    if (code === 51) return false
    if (code === 52) return true

    // fallback to autoRestart
    return !options.daemon?.autoRestart
  }

  child.on('exit', (code, signal) => {
    if (shouldExit(code!, signal!)) {
      process.exit(code!)
    }
    createWorker(options)
  })
}

export function main(options: Options) {
  if (options.daemon) return createWorker(options)
  const worker = require('./worker') as typeof import('./worker')
  worker.main(options)
}
