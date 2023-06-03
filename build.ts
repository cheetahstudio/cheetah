import { parse } from 'https://deno.land/std@0.190.0/flags/mod.ts'
import { brightRed, gray } from 'https://deno.land/std@0.190.0/fmt/colors.ts'
import * as esbuild from 'https://deno.land/x/esbuild@v0.17.19/mod.js'

export async function build({
  input = './mod.ts',
  output = './mod.js',
  banner = '// deno-fmt-ignore-file\n// deno-lint-ignore-file',
  target = 'es2022'
}: {
  /**
   * @default './mod.ts'
   */
  input?: string
  /**
   * @default './mod.js'
   */
  output?: string
  /**
   * @default '// deno-fmt-ignore-file\n// deno-lint-ignore-file'
   */
  banner?: string
  /**
   * @default 'es2022'
   */
  target?:
    | 'es2015'
    | 'es2016'
    | 'es2017'
    | 'es2018'
    | 'es2019'
    | 'es2020'
    | 'es2021'
    | 'es2022'
}) {
  const hasImportMap = async (path: string) => {
    try {
      const content = await Deno.readTextFile(path)
  
      if (!content)
        return false
  
      return JSON.parse(content).imports !== undefined
    } catch (_) {
      return false
    }
  }

  let options: string[] = []

  if (await hasImportMap('deno.json'))
    options = ['--config', 'deno.json']
  else if (await hasImportMap('deno.jsonc'))
    options = ['--config', 'deno.jsonc']
  else if (await hasImportMap('import_map.json'))
    options = ['--import-map', 'deno.json']
  else if (await hasImportMap('importMap.json'))
    options = ['--import-map', 'importMap.json']
  else if (await hasImportMap('imports.json'))
    options = ['--import-map', 'imports.json']

  const cmd = new Deno.Command('deno', {
    args: ['bundle', '-q', ...options, input, output]
  })
  
  await cmd.output()
  
  await esbuild.build({
    entryPoints: [output],
    bundle: true,
    minify: true,
    format: 'esm',
    allowOverwrite: true,
    target,
    banner: {
      js: banner
    },
    outfile: output
  })
  
  esbuild.stop()
}

if (import.meta.main) {
  const { _ } = parse(Deno.args)

  const input = _[0] && typeof _[0] === 'string' ? _[0] : undefined
  const output = _[1] && typeof _[1] === 'string' ? _[1] : undefined

  try {
    build({ input, output })
  } catch (err) {
    if (err instanceof Error)
      console.error(gray(`${brightRed('error')} - ${err.message}`))
  }
}
