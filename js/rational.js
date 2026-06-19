/**
 * rational.js — Exact rational-number (fraction) arithmetic.
 *
 * Pure ES module, no dependencies, no DOM. Numbers are assumed small,
 * so plain integer math is used (no BigInt).
 */

export class Fraction {
  /**
   * @param {number} n - numerator (integer)
   * @param {number} d - denominator (integer, default 1)
   */
  constructor(n, d = 1) {
    if (d === 0) throw new Error('Division by zero');

    // Carry sign on the numerator; denominator is always positive.
    if (d < 0) {
      n = -n;
      d = -d;
    }

    if (n === 0) {
      this.n = 0;
      this.d = 1;
      return;
    }

    const g = Fraction.gcd(n, d);
    this.n = n / g;
    this.d = d / g;
  }

  add(other) {
    other = Fraction.from(other);
    return new Fraction(this.n * other.d + other.n * this.d, this.d * other.d);
  }

  sub(other) {
    other = Fraction.from(other);
    return new Fraction(this.n * other.d - other.n * this.d, this.d * other.d);
  }

  mul(other) {
    other = Fraction.from(other);
    return new Fraction(this.n * other.n, this.d * other.d);
  }

  div(other) {
    other = Fraction.from(other);
    if (other.n === 0) throw new Error('Division by zero');
    return new Fraction(this.n * other.d, this.d * other.n);
  }

  neg() {
    return new Fraction(-this.n, this.d);
  }

  isZero() {
    return this.n === 0;
  }

  isOne() {
    return this.n === 1 && this.d === 1;
  }

  equals(other) {
    other = Fraction.from(other);
    // Both are always in normalized form, so direct comparison is safe.
    return this.n === other.n && this.d === other.d;
  }

  clone() {
    return new Fraction(this.n, this.d);
  }

  toString() {
    if (this.d === 1) return String(this.n);
    return `${this.n}/${this.d}`;
  }

  toNumber() {
    return this.n / this.d;
  }

  /**
   * Coerce a value into a Fraction.
   * - Fraction       -> a clone
   * - integer number -> new Fraction(value)
   * - string         -> parsed ("3/4", "-2", " 5 ")
   * Throws on invalid input.
   * @param {Fraction|number|string} value
   * @returns {Fraction}
   */
  static from(value) {
    if (value instanceof Fraction) {
      return value.clone();
    }

    if (typeof value === 'number') {
      if (!Number.isInteger(value)) {
        throw new Error(`Fraction.from: expected an integer, got ${value}`);
      }
      return new Fraction(value);
    }

    if (typeof value === 'string') {
      const s = value.trim();
      const match = /^(-?\d+)(?:\/(-?\d+))?$/.exec(s);
      if (!match) {
        throw new Error(`Fraction.from: cannot parse "${value}"`);
      }
      const n = parseInt(match[1], 10);
      const d = match[2] !== undefined ? parseInt(match[2], 10) : 1;
      return new Fraction(n, d);
    }

    throw new Error(`Fraction.from: unsupported input ${value}`);
  }

  /**
   * Greatest common divisor of |a| and |b| via Euclid's algorithm.
   * gcd(0, 0) = 0, gcd(x, 0) = x.
   * @returns {number} non-negative integer
   */
  static gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b !== 0) {
      [a, b] = [b, a % b];
    }
    return a;
  }
}

// --- Example assertions (expected behavior) ---
// new Fraction(2, 4).toString() === "1/2"
// new Fraction(0).toString() === "0"
// new Fraction(0, 5).d === 1
// new Fraction(3, -4).toString() === "-3/4"
// new Fraction(3, 3).isOne() === true
// new Fraction(1, 2).add(new Fraction(1, 2)).isOne() === true
// new Fraction(1, 2).add(3).toString() === "7/2"
// new Fraction(2, 3).mul(new Fraction(3, 4)).toString() === "1/2"
// new Fraction(1, 2).div(new Fraction(1, 4)).toNumber() === 2
// new Fraction(5, 6).sub(new Fraction(1, 6)).toString() === "2/3"
// new Fraction(-1, 3).neg().toString() === "1/3"
// Fraction.from("-2/4").toString() === "-1/2"
// Fraction.gcd(12, 8) === 4
// Fraction.from(new Fraction(1, 2)).equals(new Fraction(1, 2)) === true
