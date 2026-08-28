import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
} from '@nestjs/common';
import { Response } from 'express';

interface ClassValidatorError {
  property: string;
  value?: unknown;
  constraints?: Record<string, string>;
  children?: ClassValidatorError[];
}

interface ValidationField {
  field: string;
  error: string;
  received: unknown;
}

interface ValidationExceptionResponse {
  message?: unknown;
  errors?: ClassValidatorError[];
}

/** Converts class-validator errors into a compact, field-level API response. */
@Catch(BadRequestException)
export class ValidationErrorFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const exceptionResponse = exception.getResponse() as ValidationExceptionResponse;

    if (!Array.isArray(exceptionResponse?.message)) {
      response.status(exception.getStatus()).json(exceptionResponse);
      return;
    }

    const fields = this.flattenErrors(exceptionResponse.errors ?? []);
    response.status(400).json({ statusCode: 400, fields });
  }

  private flattenErrors(
    errors: ClassValidatorError[],
    prefix = '',
  ): ValidationField[] {
    const fields: ValidationField[] = [];

    for (const validationError of errors) {
      const field = prefix
        ? `${prefix}.${validationError.property}`
        : validationError.property;

      for (const error of Object.keys(validationError.constraints ?? {})) {
        fields.push({
          field,
          error,
          received: validationError.value === undefined ? null : validationError.value,
        });
      }

      if (validationError.children?.length) {
        fields.push(...this.flattenErrors(validationError.children, field));
      }
    }

    return fields;
  }
}