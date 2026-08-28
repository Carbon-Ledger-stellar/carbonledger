import { PrismaClient } from '@prisma/client';

class MyPrisma extends PrismaClient {
  constructor() {
    super();
    const extended = this.$extends({
      query: {
        $allModels: {
          findFirst({ query }) {
            console.log("Intercepted by extends!");
            return query({});
          }
        }
      }
    });

    return new Proxy(this, {
      get: (target, prop) => {
        if (prop in extended) {
          return (extended as any)[prop];
        }
        return (target as any)[prop];
      }
    }) as any;
  }

  myMethod() {
    console.log("myMethod called");
  }
}

async function run() {
  const p = new MyPrisma();
  p.myMethod();
  try {
    await p.carbonProject.findFirst();
  } catch (e) {
    console.log("Prisma call failed, but proxy works");
  }
}
run();
