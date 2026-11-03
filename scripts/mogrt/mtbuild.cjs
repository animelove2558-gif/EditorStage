const esbuild=require('esbuild');
esbuild.build({entryPoints:['src/mogrt-test.js'],bundle:true,outfile:'dist/mogrt-test.js',format:'iife',target:'chrome130',loader:{'.js':'jsx'},logLevel:'error'}).then(()=>{require('fs').copyFileSync('src/mogrt-test.html','dist/mogrt-test.html');console.log('bundled')}).catch(e=>{console.log('ERR');process.exit(1)});
