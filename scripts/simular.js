// Uso:
//   npm run simular -- reward "Invocar zombie" Pepe
//   npm run simular -- command !lluvia Pepe
//   npm run simular -- cheer bits Pepe 500
// La app (npm start) debe estar corriendo.
import 'dotenv/config';

const [type = 'reward', name = 'Invocar zombie', user = 'Tester', amount = '0', ...input] = process.argv.slice(2);
const port = process.env.PORT ?? 3000;

const res = await fetch(`http://localhost:${port}/simular`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type, name, user, amount: Number(amount), input: input.join(' ') })
});
console.log(res.ok ? `Enviado: ${type} "${name}" de ${user}` : `Error: ${res.status}`);
