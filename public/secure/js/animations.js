document.addEventListener('DOMContentLoaded', () => {
    // Betöltési animáció: elemek alulról csúsznak be
    const elements = document.querySelectorAll('.animate-in');
    elements.forEach((el, index) => {
        setTimeout(() => {
            el.classList.add('visible');
        }, index * 100); // Késleltetés, hogy egymás után jöjjenek be
    });

    // Háttér animáció: sárga pöttyök nőnek és csökkennek
    const canvas = document.getElementById('backgroundCanvas');
    const ctx = canvas.getContext('2d');

    // Canvas méretezés
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });

    // Pöttyök tömbje
    const dots = [];
    const numDots = 50;

    class Dot {
        constructor() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.radius = Math.random() * 5 + 2; // 2-7px között
            this.maxRadius = this.radius + Math.random() * 5;
            this.minRadius = this.radius - 2;
            this.growing = true;
            this.speed = Math.random() * 0.02 + 0.01; // Növekedési sebesség
        }

        update() {
            if (this.growing) {
                this.radius += this.speed;
                if (this.radius >= this.maxRadius) this.growing = false;
            } else {
                this.radius -= this.speed;
                if (this.radius <= this.minRadius) this.growing = true;
            }
        }

        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 204, 0, 0.5)'; // Sárga, félig átlátszó
            ctx.fill();
        }
    }

    // Pöttyök inicializálása
    for (let i = 0; i < numDots; i++) {
        dots.push(new Dot());
    }

    // Animációs ciklus
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        dots.forEach(dot => {
            dot.update();
            dot.draw();
        });
        requestAnimationFrame(animate);
    }

    animate();
});