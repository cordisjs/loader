import registerStartCommand from './start'
import CAC from 'cac'

const { version } = require('../package.json')
const cli = CAC('cordis').help().version(version)

registerStartCommand(cli)

cli.parse()

if (!cli.matchedCommand) {
  cli.outputHelp()
}
