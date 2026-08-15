export class OperationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'OperationError';
    this.status = status;
  }
}
