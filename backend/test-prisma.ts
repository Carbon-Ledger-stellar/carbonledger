import { PrismaClient } from '@prisma/client';

class MyPrisma extends PrismaClient {
  constructor() {
    super();
    return this.$extends({
      query: {
        $allModels: {
          findFirst({ query }) {
            console.log("Intercepted!");
            return query({});
          }
        }
      }
    }) as this;
  }
}

const p = new MyPrisma();
p.carbonProject.findFirst().then(() => console.log("Done")).catch(console.error);
