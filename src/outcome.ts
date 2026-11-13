/**
 * A value, or why there isn't one, from a step that can fail: the result the
 * git and file-system modules share.
 */
export type Outcome<T> =
  | {
      /**
       * Whether there is a value; `false` here.
       *
       * @example false
       */
      isOk: false;

      /**
       * Why not.
       *
       * @example "No bundle directory at /repo/docs/decisions."
       */
      reason: string;
    }
  | {
      /**
       * Whether there is a value; `true` here.
       *
       * @example true
       */
      isOk: true;

      /**
       * The value.
       *
       * @example "/repo"
       */
      value: T;
    };
