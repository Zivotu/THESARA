import { ApiError } from './api';

export function handleFetchError(
  error: unknown,
  message?: string
) {
  let displayMessage = message || 'An unexpected error occurred.';

  if (error instanceof ApiError) {
    displayMessage = error.message;
  } else if (error instanceof TypeError) {
    displayMessage = 'Network request failed. Please check your connection.';
  } else if (error instanceof Error) {
    displayMessage = error.message;
  }

  console.error(displayMessage, error);

  if (error instanceof TypeError) {
    console.error(
      'Network request failed. Verify that the API URL is correct and that CORS is properly configured.'
    );
  }
}
