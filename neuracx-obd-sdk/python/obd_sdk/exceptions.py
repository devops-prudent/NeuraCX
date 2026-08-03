class OBDValidationError(ValueError):
    """Raised when a request is built with missing/invalid parameters, before any network call is made."""


class OBDApiError(Exception):
    """Raised when the OBD API returns a non-2xx response, or the request fails on the network."""

    def __init__(self, message, status_code=None, response_body=None):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body
