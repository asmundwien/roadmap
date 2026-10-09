export function parseProofOptions(args, allowNegativeOnly = false) {
  const options = { help: false, case: null, negativeOnly: false }
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--help') options.help = true
    else if (argument === '--negative-only' && allowNegativeOnly) options.negativeOnly = true
    else if (argument === '--case') {
      if (options.case !== null) throw new Error('Use --case only once.')
      const value = args[++index]
      if (!value || value.startsWith('-'))
        throw new Error('--case requires a fixture name. Use --help for an executable example.')
      options.case = value
    } else
      throw new Error(`Unknown option ${argument}. Use --help for supported flags and examples.`)
  }
  return options
}
