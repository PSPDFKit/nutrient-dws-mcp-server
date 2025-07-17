#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

const packageJsonPath = join(rootDir, 'package.json')
if (!existsSync(packageJsonPath)) {
  throw new Error('package.json not found in project root')
}

const packageJson = await import(packageJsonPath, { assert: { type: 'json' } }).then(m => m.default)

if (!packageJson.name) {
  throw new Error('package.json is missing required "name" field')
}
if (!packageJson.version) {
  throw new Error('package.json is missing required "version" field')
}

console.log(`📦 Packing ${packageJson.name} v${packageJson.version}`)
console.log('')

async function generateManifest() {
  const toolDefinitionsPath = join(rootDir, 'dist/tool-definitions.js')
  if (!existsSync(toolDefinitionsPath)) {
    throw new Error('dist/tool-definitions.js not found. Run "pnpm run build" first.')
  }
  
  const { toolDefinitions } = await import('../dist/tool-definitions.js')
  
  if (!toolDefinitions || toolDefinitions.length === 0) {
    throw new Error('No tool definitions found in tool-definitions.js')
  }
  const manifestTools = toolDefinitions.map((tool, index) => {
    if (!tool.name) {
      throw new Error(`Tool at index ${index} is missing required "name" field`)
    }
    if (!tool.publicDescription) {
      throw new Error(`Tool "${tool.name}" is missing required "publicDescription" field`)
    }
    return {
      name: tool.name,
      description: tool.publicDescription
    }
  })

  function parseAuthor(author: string | undefined, fallbackUrl: string | undefined) {
    if (!author) {
      console.warn('⚠️  package.json is missing "author" field, using "Unknown"')
      return { name: 'Unknown', url: fallbackUrl }
    }
    
    const authorMatch = author.match(/^(.+?)\s*\((.+?)\)$/)
    return {
      name: authorMatch ? authorMatch[1] : author,
      url: authorMatch ? authorMatch[2] : fallbackUrl
    }
  }
  
  const { name: authorName, url: authorUrl } = parseAuthor(packageJson.author, packageJson.homepage)

  function getEntryPoint(bin: any): string {
    if (!bin) return 'dist/index.js'
    return typeof bin === 'string' ? bin : Object.values(bin)[0] as string
  }
  
  const entryPoint = getEntryPoint(packageJson.bin)

  function expandKeywords(baseKeywords: string[] = []): string[] {
    if (!Array.isArray(baseKeywords)) {
      console.warn('⚠️  package.json "keywords" field is not an array, ignoring')
      baseKeywords = []
    }
    const domainKeywords = [
      'document', 'pdf', 'extract', 'convert', 'sign', 'watermark', 'annotation', 'form', 'edit'
    ]
    return [...new Set([...baseKeywords, ...domainKeywords])]
  }
  
  const uniqueKeywords = expandKeywords(packageJson.keywords)

  function getDocumentationUrl(repoUrl: string | undefined, homepage: string | undefined): string {
    if (!repoUrl) {
      if (!homepage) {
        console.warn('⚠️  Neither repository.url nor homepage found in package.json')
      }
      return homepage || ''
    }
    return repoUrl.replace('git+', '').replace('.git', '')
  }
  
  function getSupportUrl(bugs: any, repoUrl: string | undefined): string {
    if (bugs) {
      return typeof bugs === 'string' ? bugs : bugs.url || ''
    }
    if (!repoUrl) {
      console.warn('⚠️  No bugs field or repository.url found in package.json for support URL')
      return ''
    }
    return `${repoUrl.replace('git+', '').replace('.git', '')}/issues`
  }

  if (!packageJson.homepage) {
    console.warn('⚠️  package.json is missing "homepage" field')
  }
  if (!packageJson.license) {
    console.warn('⚠️  package.json is missing "license" field')
  }
  if (!packageJson.repository) {
    console.warn('⚠️  package.json is missing "repository" field')
  }

  return {
    dxt_version: '0.1',
    name: packageJson.name,
    display_name: 'Nutrient DWS MCP Server',
    version: packageJson.version,
    description: 'Document and PDF reading, writing and creation.',
    long_description: 'Enabling document operations such as digital signing, document generation, document editing, OCR, watermarking, redaction, and more.',
    author: {
      name: authorName,
      email: 'support@nutrient.io',
      url: authorUrl
    },
    homepage: packageJson.homepage || '',
    documentation: getDocumentationUrl(packageJson.repository?.url, packageJson.homepage),
    support: getSupportUrl(packageJson.bugs, packageJson.repository?.url),
    icon: 'resources/nutrient-logo.png',
    screenshots: ['resources/readme-header.png'],
    server: {
      type: 'node',
      entry_point: entryPoint,
      mcp_config: {
        command: 'node',
        args: [`\${__dirname}/${entryPoint}`],
        env: {
          SANDBOX_PATH: '${user_config.SANDBOX_PATH}',
          NUTRIENT_DWS_API_KEY: '${user_config.NUTRIENT_DWS_API_KEY}'
        }
      }
    },
    tools: manifestTools,
    user_config: {
      NUTRIENT_DWS_API_KEY: {
        type: 'string',
        title: 'Nutrient DWS API Key',
        description: 'Get a Nutrient DWS API key: https://dashboard.nutrient.io/sign_up/',
        required: true,
        sensitive: true
      },
      SANDBOX_PATH: {
        type: 'directory',
        title: 'Local DWS Sandbox Directory',
        description: 'Directory to use as a sandbox for file operations. When enabled, all file operations will be restricted to this directory.',
        required: false,
        sensitive: false,
        default: '${HOME}/Documents'
      }
    },
    keywords: uniqueKeywords,
    license: packageJson.license || 'UNLICENSED',
    repository: packageJson.repository
  }
}

async function createDxtDirectory() {
  console.log('📦 Creating DXT package...')
  
  const outputDir = join(rootDir, 'dxt')
  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true })
  }
  mkdirSync(outputDir, { recursive: true })

  console.log('📄 Generating manifest.json...')
  const manifest = await generateManifest()
  const manifestPath = join(outputDir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log('✅ Created manifest.json')
  console.log(`🛠️  Tools: ${manifest.tools.length}`)

  const requiredFiles: string[] = packageJson.files
  if (!requiredFiles || requiredFiles.length === 0) {
    throw new Error('package.json "files" field is empty or undefined. Cannot determine which files to include in the DXT package.')
  }
  let copiedFiles = 0

  const missingFiles: string[] = []
  
  for (const file of requiredFiles) {
    const sourcePath = join(rootDir, file)
    const destPath = join(outputDir, file)
    
    if (existsSync(sourcePath)) {
      cpSync(sourcePath, destPath, { recursive: true })
      console.log(`✅ Copied ${file}`)
      copiedFiles++
    } else {
      console.log(`⚠️  ${file} not found, skipping`)
      missingFiles.push(file)
    }
  }
  
  if (missingFiles.length > 0) {
    console.log(`\n⚠️  Warning: ${missingFiles.length} file(s) listed in package.json "files" were not found:`)
    missingFiles.forEach(file => console.log(`   - ${file}`))
  }

  // Create production-only package.json (exclude devDependencies)
  const productionPackageJson = {
    ...packageJson,
    devDependencies: undefined, // Remove devDependencies
    scripts: undefined // Remove scripts as they're not needed in production
  }
  
  writeFileSync(join(outputDir, 'package.json'), JSON.stringify(productionPackageJson, null, 2) + '\n')
  console.log('✅ Created production package.json (without devDependencies)')
  copiedFiles++

  // Install production dependencies in dist/ directory (alongside index.js)
  console.log(`📦 Installing production dependencies in dist/ directory...`)
  
  try {
    const distDir = join(outputDir, 'dist')
    // Copy package.json to dist/ directory for npm install
    cpSync(join(outputDir, 'package.json'), join(distDir, 'package.json'))
    
    // Use npm install with --prefix to install to dist/ directory
    console.log('🔄 Running npm install --omit=dev...')
    execSync(`npm install --prefix "${distDir}" --omit=dev --omit=optional --omit=peer --no-audit --no-fund --production`, { 
      cwd: rootDir,
      stdio: 'inherit'
    })
    
    // Verify node_modules was created in dist/
    const nodeModulesPath = join(distDir, 'node_modules')
    if (existsSync(nodeModulesPath)) {
      console.log(`✅ Installed production dependencies (dist/node_modules)`)
      copiedFiles++ // Count node_modules as an additional item
    } else {
      console.log(`⚠️  node_modules directory was not created despite successful install`)
    }
    
  } catch (error) {
    console.log(`⚠️  Failed to install production dependencies: ${error instanceof Error ? error.message : String(error)}`)
    console.log(`📦 DXT package will be created without node_modules`)
  }

  console.log(`\n📊 Package created: ${copiedFiles} items copied`)
  
  return createDxtPackage(outputDir, packageJson.name, packageJson.version)
}

function createDxtPackage(outputDir: string, packageName: string, version: string): string {
  console.log('\n📦 Creating DXT package...')
  
  try {
    // The dxt pack command creates a file named "dxt.dxt" by default
    const defaultDxtPath = join(outputDir, 'dxt.dxt')
    const expectedDxtName = `${packageName.replace('@', '').replace('/', '-')}-${version}.dxt`
    const expectedDxtPath = join(outputDir, expectedDxtName)
    
    // Remove any existing DXT files
    if (existsSync(defaultDxtPath)) {
      rmSync(defaultDxtPath)
    }
    if (existsSync(expectedDxtPath)) {
      rmSync(expectedDxtPath)
    }
    
    execSync(`npx @anthropic-ai/dxt pack`, { 
      cwd: outputDir,
      stdio: 'inherit'
    })
    
    // Check if the default dxt.dxt was created
    if (!existsSync(defaultDxtPath)) {
      throw new Error('DXT package was not created successfully')
    }
    
    // Rename to expected filename
    rmSync(expectedDxtPath, { force: true })
    cpSync(defaultDxtPath, expectedDxtPath)
    rmSync(defaultDxtPath)
    
    const stats = statSync(expectedDxtPath)
    const sizeInMB = (stats.size / 1024 / 1024).toFixed(2)
    
    console.log(`✅ Created ${expectedDxtName} (${sizeInMB} MB)`)
    
    return expectedDxtPath
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('command not found') || message.includes('not recognized')) {
      throw new Error('@anthropic-ai/dxt command not found. Please install with: npm install -g @anthropic-ai/dxt')
    }
    throw new Error(`Failed to create DXT package: ${message}`)
  }
}

async function main(): Promise<void> {
  try {
    const result = await createDxtDirectory()
    
    console.log('\n🎉 DXT package created!')
    console.log(`📦 Output: ${result}`)
    
  } catch (error) {
    console.error('❌ Packaging failed:', error instanceof Error ? error.message : String(error))
    throw error
  }
}

main()
