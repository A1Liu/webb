use serde::{Deserialize, Serialize};

const ID_MASK: u32 = 0b10100110_01101010_01001010_10101010;
const ID_ADD: u32 = 2740160927;

// These two numbers are multiplicative inverses mod 2^32
const ID_MUL_TO: u32 = 0x01000193;
const ID_MUL_FROM: u32 = 0x359c449b;

// const ID_ROTATE_BITS: u32 = 16;
// let s2 = s1.swap_bytes();
// let s5 = s4.rotate_left(ID_ROTATE_BITS);

#[derive(Debug, Clone, Copy, PartialEq, Hash, Serialize, Deserialize)]
#[repr(transparent)]
pub struct Id32(u32);

impl Id32 {
    pub fn from_seed(seed: u32) -> Self {
        let s3 = seed.wrapping_add(ID_ADD);
        let s2 = s3.wrapping_mul(ID_MUL_FROM);
        let s1 = s2 ^ ID_MASK;

        return Self(s1);
    }

    pub fn get_seed(self) -> u32 {
        let s1 = self.0 ^ ID_MASK;
        let s2 = s1.wrapping_mul(ID_MUL_TO);
        let s3 = s2.wrapping_sub(ID_ADD);

        return s3;
    }
}

#[test]
fn id_test() {
    assert_eq!(ID_MUL_TO.wrapping_mul(ID_MUL_FROM), 1);

    let tests = &[ID_MASK, ID_ADD, ID_MUL_TO, ID_MUL_FROM];

    for id in 0..100 {
        let value = Id32::from_seed(id);
        let out_id = value.get_seed();

        // println!("{} -> {}", id, value);

        // println!("{:>10}", value);

        assert_eq!(id, out_id);
    }

    for &id in tests {
        let value = Id32::from_seed(id);
        let out_id = value.get_seed();

        // println!("{} -> {}", id, value);

        assert_eq!(id, out_id);
    }

    for value in 0..100 {
        let id = Id32(value).get_seed();
        let out_value = Id32::from_seed(id);

        // println!("{} -> {}", id, value);

        assert_eq!(value, out_value.0);
    }
}
