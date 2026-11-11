// Movie-title limits, kept free of dependencies so client components can
// import them without pulling the validation library into the browser bundle.
export const MOVIE_TITLE_MIN_LENGTH = 1; // real titles can be one character, e.g. "M" (1931)
export const MOVIE_TITLE_MAX_LENGTH = 100;
