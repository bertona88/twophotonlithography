pub type V = [f64; 3];
pub type M = [[f64; 3]; 3];
pub const ID: M = [[1., 0., 0.], [0., 1., 0.], [0., 0., 1.]];
pub fn add(a: V, b: V) -> V {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
pub fn sub(a: V, b: V) -> V {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub fn scale(a: V, s: f64) -> V {
    [a[0] * s, a[1] * s, a[2] * s]
}
pub fn dot(a: V, b: V) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub fn cross(a: V, b: V) -> V {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
pub fn norm(a: V) -> f64 {
    dot(a, a).sqrt()
}
pub fn transpose(a: M) -> M {
    std::array::from_fn(|i| std::array::from_fn(|j| a[j][i]))
}
pub fn mul(a: M, b: M) -> M {
    std::array::from_fn(|i| std::array::from_fn(|j| (0..3).map(|k| a[i][k] * b[k][j]).sum()))
}
pub fn mv(a: M, b: V) -> V {
    std::array::from_fn(|i| dot(a[i], b))
}
pub fn det(a: M) -> f64 {
    dot(a[0], cross(a[1], a[2]))
}
pub fn inv(a: M) -> M {
    let d = det(a);
    transpose([
        scale(cross(a[1], a[2]), 1. / d),
        scale(cross(a[2], a[0]), 1. / d),
        scale(cross(a[0], a[1]), 1. / d),
    ])
}
pub fn sm(a: M, s: f64) -> M {
    a.map(|r| scale(r, s))
}
pub fn am(a: M, b: M) -> M {
    std::array::from_fn(|i| add(a[i], b[i]))
}
pub fn trace(a: M) -> f64 {
    a[0][0] + a[1][1] + a[2][2]
}
pub fn inner(a: M, b: M) -> f64 {
    (0..3).map(|i| dot(a[i], b[i])).sum()
}
pub fn outer(a: V, b: V) -> M {
    std::array::from_fn(|i| scale(b, a[i]))
}
pub fn spd(a: M) -> bool {
    a.iter().flatten().all(|x| x.is_finite())
        && (0..3).all(|i| (0..3).all(|j| (a[i][j] - a[j][i]).abs() < 1e-9))
        && a[0][0] > 0.
        && a[0][0] * a[1][1] - a[0][1] * a[1][0] > 0.
        && det(a) > 1e-10
}
