/**
 * This file was auto-generated from openapi.yaml by openapi-typescript.
 * Do not make direct changes to the file.
 *
 * Regenerate with: npm run generate:api-types
 */

export interface paths {
  "/health": {
    /** Health check */
    get: operations["getHealth"];
  };
  "/credits": {
    /** List credits */
    get: operations["listCredits"];
    /** Create a credit */
    post: operations["createCredit"];
  };
  "/credits/{id}": {
    /** Get a credit by id */
    get: operations["getCredit"];
    /** Update a credit */
    put: operations["updateCredit"];
    /** Delete a credit */
    delete: operations["deleteCredit"];
  };
}

export interface components {
  schemas: {
    Health: {
      status: "ok" | "degraded" | "down";
      version?: string;
      uptimeSeconds?: number;
    };
    Credit: {
      id: string;
      amount: number;
      currency: string;
      status: "pending" | "active" | "settled" | "cancelled";
      createdAt: string;
      updatedAt?: string;
    };
    CreditCreate: {
      amount: number;
      currency: string;
      status?: "pending" | "active" | "settled" | "cancelled";
    };
    CreditUpdate: {
      amount?: number;
      currency?: string;
      status?: "pending" | "active" | "settled" | "cancelled";
    };
    Error: {
      code: string;
      message: string;
    };
  };
  responses: {
    /** @description Unexpected error */
    Error: {
      content: {
        "application/json": components["schemas"]["Error"];
      };
    };
  };
}

export interface operations {
  getHealth: {
    responses: {
      200: {
        content: {
          "application/json": components["schemas"]["Health"];
        };
      };
      default: components["responses"]["Error"];
    };
  };
  listCredits: {
    responses: {
      200: {
        content: {
          "application/json": components["schemas"]["Credit"][];
        };
      };
      default: components["responses"]["Error"];
    };
  };
  createCredit: {
    requestBody: {
      content: {
        "application/json": components["schemas"]["CreditCreate"];
      };
    };
    responses: {
      201: {
        content: {
          "application/json": components["schemas"]["Credit"];
        };
      };
      default: components["responses"]["Error"];
    };
  };
  getCredit: {
    parameters: {
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": components["schemas"]["Credit"];
        };
      };
      default: components["responses"]["Error"];
    };
  };
  updateCredit: {
    parameters: {
      path: {
        id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["CreditUpdate"];
      };
    };
    responses: {
      200: {
        content: {
          "application/json": components["schemas"]["Credit"];
        };
      };
      default: components["responses"]["Error"];
    };
  };
  deleteCredit: {
    parameters: {
      path: {
        id: string;
      };
    };
    responses: {
      204: {
        content: never;
      };
      default: components["responses"]["Error"];
    };
  };
}

export type Health = components["schemas"]["Health"];
export type Credit = components["schemas"]["Credit"];
export type CreditCreate = components["schemas"]["CreditCreate"];
export type CreditUpdate = components["schemas"]["CreditUpdate"];
export type ApiError = components["schemas"]["Error"];
