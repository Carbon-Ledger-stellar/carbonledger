import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ValidationErrorCatalog, ValidationErrorResponse } from './validation-error.catalog';

interface ClassValidatorError {
  property: string;
  constraints?: Record<string, string>;
  children?: ClassValidatorError[];
}

/**
 * Global exception filter for validation errors produced by NestJS
 * ValidationPipe (class-validator).
 *
 * Transforms the default NestJS validation error format into the
 * CarbonLedger standard error catalog format:
 *
 * {
 *   statusCode: 400,
 *   error: "Bad Request",
 *   code: "VALIDATION_FAILED",
 *   message: "Request validation failed.",
 *   errors: [{ field, message, code, hint }]
 * }
 *
 * Registration: add as APP_FILTER in AppModule providers, or apply with
 * `@UseFilters(ValidationExceptionFilter)` on a controller.
 */
@Catch(BadRequestException)
export class ValidationExceptionFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const exceptionResponse = exception.getResponse() as any;

    // Only intercept class-validator ValidationPipe errors (which have a
    // "message" array). Pass through plain BadRequestExceptions, adding a
    // standardized `code` (#966) if the exception didn't already set one.
    if (!Array.isArray(exceptionResponse?.message)) {
      response.status(400).json({ code: 'BAD_REQUEST', ...exceptionResponse });
      return;
    }

    const rawErrors: ClassValidatorError[] = (exceptionResponse as any).errors ?? [];
    const errors = this.flattenErrors(rawErrors);

    const body: ValidationErrorResponse = {
      statusCode: 400,
      error: 'Bad Request',
      code: 'VALIDATION_FAILED',
      message: ValidationErrorCatalog.VALIDATION_FAILED.message,
      errors,
    };

    response.status(400).json(body);
  }

  /**
   * Recursively flattens nested class-validator errors into a flat list
   * with dot-notation field paths (e.g. "coordinates.lat").
   */
  private flattenErrors(
    errors: ClassValidatorError[],
    prefix = '',
  ): ValidationErrorResponse['errors'] {
    const result: ValidationErrorResponse['errors'] = [];

    for (const err of errors) {
      const field = prefix ? `${prefix}.${err.property}` : err.property;

      if (err.constraints) {
        for (const [constraintName, message] of Object.entries(err.constraints)) {
          const catalogEntry = this.lookupCatalogEntry(constraintName, field);
          result.push({
            field,
            message: catalogEntry?.message ?? message,
            code: catalogEntry?.code,
            hint: catalogEntry?.hint,
          });
        }
      }

      if (err.children?.length) {
        result.push(...this.flattenErrors(err.children, field));
      }
    }

    return result;
  }

  /**
   * Maps a class-validator constraint name and field name to a catalog entry.
   */
  private lookupCatalogEntry(
    constraintName: string,
    _field: string,
  ): (typeof ValidationErrorCatalog)[keyof typeof ValidationErrorCatalog] | undefined {
    const map: Record<string, keyof typeof ValidationErrorCatalog> = {
      // Custom validators
      IsStellarAddress:     'STELLAR_ADDRESS_INVALID',
      IsSerialNumber:       'SERIAL_NUMBER_FORMAT',
      ValidSerialRange:     'SERIAL_NUMBER_RANGE',
      IsVintageYear:        'VINTAGE_YEAR_TOO_OLD',
      IsCreditAmount:       'CREDIT_AMOUNT_TOO_SMALL',
      IsIpfsCid:            'IPFS_CID_INVALID',
      IsMethodologyScore:   'METHODOLOGY_SCORE_OUT_OF_RANGE',
      // class-validator built-ins
      isNotEmpty:           'FIELD_REQUIRED',
      isString:             'FIELD_INVALID_FORMAT',
      maxLength:            'FIELD_TOO_LONG',
      length:               'FIELD_INVALID_FORMAT',
      matches:              'FIELD_INVALID_FORMAT',
      isInt:                'FIELD_INVALID_FORMAT',
      isNumber:             'FIELD_INVALID_FORMAT',
      isPositive:           'CREDIT_AMOUNT_NOT_POSITIVE',
      min:                  'NUMBER_OUT_OF_RANGE',
      max:                  'NUMBER_OUT_OF_RANGE',
      arrayMinSize:         'ARRAY_EMPTY',
      arrayMaxSize:         'ARRAY_TOO_LARGE',
      whitelistValidation:  'UNKNOWN_FIELD',
    };

    const catalogKey = map[constraintName];
    return catalogKey ? ValidationErrorCatalog[catalogKey] : undefined;
  }
}
