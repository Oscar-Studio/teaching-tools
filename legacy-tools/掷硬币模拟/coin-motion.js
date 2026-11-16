// The cylinder and table use coin radii as units. The toss rotates about a
// horizontal axis; each coin gets its own launch, spin and in-plane direction.
const coinMotion = (() => {
  const halfThickness = 1.85 / 22.25;
  const inertia = 1 / 4 + halfThickness ** 2 / 3; // solid cylinder, unit mass
  const dt = 1 / 240;
  const supportHeight = (angle) => Math.abs(Math.sin(angle)) + halfThickness * Math.abs(Math.cos(angle));

  function physicalToss() {
    let angle = (Math.random() - .5) * .24;
    let spin = (16 + Math.random() * 7) * (Math.random() < .5 ? -1 : 1);
    let y = supportHeight(angle);
    let velocity = 8.7 + Math.random() * 1.1;
    // The two sides have identical physics. Randomly assign which starts up
    // without changing the launch or contacts; neither face has an advantage.
    const faceOffset = Math.random() < .5 ? 0 : Math.PI;
    const yaw = (Math.random() - .5) * 100;
    const path = [];
    for (let step = 0; step <= 360; step++) {
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const support = Math.abs(sin) + halfThickness * Math.abs(cos);
      if (step % 6 === 0) path.push({ angle: angle + faceOffset, y: Math.max(y, support) });
      if (y < support) {
        y = support;
        // A contact impulse acts at the lowest rim point and changes both
        // vertical velocity and spin. Small impacts lose their bounce.
        const arm = Math.sign(sin) * cos - halfThickness * Math.sign(cos) * sin;
        const contactVelocity = velocity - arm * spin;
        if (contactVelocity < 0) {
          const restitution = contactVelocity < -1.2 ? .18 : 0;
          const impulse = -(1 + restitution) * contactVelocity / (1 + arm ** 2 / inertia);
          velocity += impulse;
          spin = (spin - arm * impulse / inertia) * .63;
        }
        if (Math.abs(velocity) < 1.1 && Math.abs(spin) < 2.8) break;
      }
      velocity -= 20 * dt;
      y += velocity * dt;
      angle += spin * dt;
    }
    // Once the bounce dies out, let gravity tip the rim down to the nearer
    // face. Follow the cylinder's support height so it stays on the table.
    const landed = Math.round(angle / Math.PI);
    const flat = landed * Math.PI;
    for (let i = 1; i <= 9; i++) {
      const tipping = flat + (angle - flat) * Math.cos(i / 9 * Math.PI / 2);
      path.push({ angle: tipping + faceOffset, y: supportHeight(tipping) });
    }
    return { path, yaw, tail: Boolean((landed + Number(faceOffset > 0)) % 2) };
  }

  function animatedToss(fromTail, tail, quick) {
    const from = fromTail ? Math.PI : 0;
    const to = (quick ? 2 : 4) * Math.PI + (tail ? Math.PI : 0);
    return {
      tail,
      yaw: 0,
      path: [
        { angle: from, y: halfThickness },
        { angle: from + (to - from) * .18, y: 2.25 },
        { angle: from + (to - from) * .37, y: 3.4 },
        { angle: from + (to - from) * .55, y: 3.6 },
        { angle: from + (to - from) * .76, y: 2.7 },
        { angle: to - .18, y: .39 },
        { angle: to + .08, y: .17 },
        { angle: to, y: halfThickness },
      ],
    };
  }

  return { physicalToss, animatedToss, halfThickness };
})();
