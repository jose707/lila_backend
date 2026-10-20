// backend/src/services/__fixtures__/ciTraseraEspacial.fixtures.js
// Fixtures ESPACIALES de la trasera: la geometría no debe romper la
// extracción posicional del MRZ. Formato:
// { name, input, words: [{text,x,y,w,h}], expected }.
module.exports = [
  {
    name: 'espacial trasera: MRZ completo con geometría',
    input: [
      'DOMICILIO',
      'AV. 6 DE AGOSTO NRO. 2456',
      'PROFESION',
      'INGENIERO',
      'ESTADO CIVIL',
      'SOLTERO',
      'IDBOL1234567<4<<<<<<<<<<<<<<',
      '9008157M3309195BOL<<<<<<<<<<<2',
      'MAMANI<QUISPE<<JUAN<CARLOS<<<',
    ].join('\n'),
    words: [
      { text: 'DOMICILIO', x: 20, y: 60, w: 90, h: 14 },
      { text: 'AV.', x: 20, y: 84, w: 40, h: 18 },
      { text: '6', x: 65, y: 84, w: 15, h: 18 },
      { text: 'DE', x: 85, y: 84, w: 25, h: 18 },
      { text: 'AGOSTO', x: 115, y: 84, w: 80, h: 18 },
      { text: 'NRO.', x: 200, y: 84, w: 45, h: 18 },
      { text: '2456', x: 250, y: 84, w: 50, h: 18 },
      { text: 'PROFESION', x: 20, y: 130, w: 90, h: 14 },
      { text: 'INGENIERO', x: 20, y: 154, w: 90, h: 18 },
      { text: 'ESTADO', x: 20, y: 200, w: 70, h: 14 },
      { text: 'CIVIL', x: 95, y: 200, w: 50, h: 14 },
      { text: 'SOLTERO', x: 20, y: 224, w: 80, h: 18 },
      { text: 'IDBOL1234567<4<<<<<<<<<<<<<<', x: 20, y: 300, w: 320, h: 14 },
      { text: '9008157M3309195BOL<<<<<<<<<<<2', x: 20, y: 320, w: 330, h: 14 },
      { text: 'MAMANI<QUISPE<<JUAN<CARLOS<<<', x: 20, y: 340, w: 330, h: 14 },
    ],
    expected: {
      ciNumber: '1234567',
      birthDate: '15/08/1990',
      fullName: 'MAMANI QUISPE JUAN CARLOS',
      mrz: true,
    },
  },
  {
    name: 'espacial trasera: MRZ ruidoso (IDB0L y fecha ilegible)',
    input: [
      'DOMICILIO',
      'AV. TUMUSLA 400',
      'IDB0L2583691<7<<<<<<<<<<<<<<',
      '9OO8157M3309195BOL<<<<<<<<<<<2',
      'MAMANI<QUISPE<<JUAN<CARLOS<<<',
    ].join('\n'),
    words: [
      { text: 'DOMICILIO', x: 20, y: 60, w: 90, h: 14 },
      { text: 'AV.', x: 20, y: 84, w: 40, h: 18 },
      { text: 'TUMUSLA', x: 65, y: 84, w: 85, h: 18 },
      { text: '400', x: 155, y: 84, w: 40, h: 18 },
      { text: 'IDB0L2583691<7<<<<<<<<<<<<<<', x: 20, y: 160, w: 320, h: 14 },
      { text: '9OO8157M3309195BOL<<<<<<<<<<<2', x: 20, y: 180, w: 330, h: 14 },
      { text: 'MAMANI<QUISPE<<JUAN<CARLOS<<<', x: 20, y: 200, w: 330, h: 14 },
    ],
    expected: {
      ciNumber: '2583691',
      birthDate: '',
      fullName: 'MAMANI QUISPE JUAN CARLOS',
      mrz: true,
    },
  },
];
