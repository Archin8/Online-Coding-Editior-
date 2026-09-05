import Docker from 'dockerode';

const docker = new Docker();

const IMAGES = [
  'node:20-alpine',
  'python:3.12-alpine',
  'eclipse-temurin:21-jdk-alpine',
  'gcc:14',
  'golang:1.22-alpine',
];

async function pullImage(imageName) {
  console.log(`⏳ Pulling ${imageName}...`);
  return new Promise((resolve, reject) => {
    docker.pull(imageName, (err, stream) => {
      if (err) {
        console.error(`❌ Failed to pull ${imageName}:`, err.message);
        reject(err);
        return;
      }
      docker.modem.followProgress(stream, (err) => {
        if (err) {
          console.error(`❌ Failed to pull ${imageName}:`, err.message);
          reject(err);
        } else {
          console.log(`✅ Successfully pulled ${imageName}`);
          resolve();
        }
      }, (event) => {
        // Show progress
        if (event.status === 'Downloading' || event.status === 'Extracting') {
          process.stdout.write(`   ${imageName}: ${event.status} ${event.progress || ''}\r`);
        }
      });
    });
  });
}

async function main() {
  console.log('🐳 Pulling Docker images for code execution...\n');
  console.log('This is a one-time setup. Images will be cached locally.\n');

  let success = 0;
  let failed = 0;

  for (const image of IMAGES) {
    try {
      await pullImage(image);
      success++;
    } catch {
      failed++;
    }
  }

  console.log(`\n📊 Results: ${success} succeeded, ${failed} failed out of ${IMAGES.length} total`);

  if (failed > 0) {
    console.log('\n⚠️  Some images failed to pull. Make sure Docker is running and try again.');
    process.exit(1);
  } else {
    console.log('\n🎉 All images pulled successfully! You can now run code in all supported languages.');
  }
}

main();
