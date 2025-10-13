import { prisma } from '../src/prisma/client';

async function main() {
  // Intentionally left to no-op; seed script exists for parity and can be extended later.
  console.log('No seed data defined for Rooms V1 (intentional noop).');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
