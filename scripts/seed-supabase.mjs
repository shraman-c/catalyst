import './load-env.mjs';
import postgres from 'postgres';
import { randomUUID } from 'crypto';

const sql = postgres(process.env.DATABASE_URL);

function id() { return randomUUID(); }
const now = () => new Date().toISOString();

// Simple password hash matching the app's hashPassword function
function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'synthesizer-salt');
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data[i];
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36) + data.length.toString(36);
}

// Test data
const USER_ID = id();
const SUBJECT_ID = id();

const notes = [
  {
    id: id(),
    filename: 'cell-biology.md',
    content: `# Cell Biology

## The Cell Membrane
The cell membrane (plasma membrane) is a biological membrane that separates the interior of all cells from the outside environment. It consists of a lipid bilayer with embedded proteins. The membrane is selectively permeable, allowing certain substances to pass while blocking others.

Key functions:
- Protects the cell from its environment
- Controls what enters and leaves the cell
- Facilitates cell signaling and communication

## Mitochondria
Mitochondria are membrane-bound organelles found in the cytoplasm of eukaryotic cells. They are often called the "powerhouse of the cell" because they generate most of the cell's supply of adenosine triphosphate (ATP), used as a source of chemical energy.

## Ribosomes
Ribosomes are molecular machines found within all living cells. They serve as the site of biological protein synthesis. Ribosomes link amino acids together in the order specified by messenger RNA (mRNA) molecules.`,
    content_hash: randomUUID().replace(/-/g, ''),
  },
  {
    id: id(),
    filename: 'photosynthesis.md',
    content: `# Photosynthesis

## Overview
Photosynthesis is a process used by plants and other organisms to convert light energy into chemical energy. Through this process, plants absorb carbon dioxide and water, and produce glucose and oxygen.

## Light-Dependent Reactions
These reactions occur in the thylakoid membrane of chloroplasts. They require light energy to produce ATP and NADPH. Water molecules are split, releasing oxygen as a byproduct.

## Calvin Cycle
The Calvin cycle takes place in the stroma of chloroplasts. It uses ATP and NADPH from the light-dependent reactions to fix carbon dioxide into organic molecules, ultimately producing glucose.

## Factors Affecting Photosynthesis
- Light intensity
- Carbon dioxide concentration
- Temperature
- Water availability`,
    content_hash: randomUUID().replace(/-/g, ''),
  },
  {
    id: id(),
    filename: 'genetics-basics.md',
    content: `# Genetics Basics

## DNA Structure
DNA (deoxyribonucleic acid) is a molecule composed of two polynucleotide chains that coil around each other to form a double helix. It carries the genetic instructions for the development, functioning, growth and reproduction of all known organisms.

## Genes and Alleles
A gene is a sequence of DNA that encodes for a specific protein. Alleles are different versions of the same gene. Organisms inherit two alleles for each gene, one from each parent.

## Mendelian Inheritance
Gregor Mendel established the fundamental laws of inheritance:
1. **Law of Segregation**: Each individual has two alleles for each gene, and these separate during gamete formation.
2. **Law of Independent Assortment**: Genes for different traits can segregate independently during the formation of gametes.

## Genetic Mutations
Mutations are changes in the DNA sequence. They can be:
- Point mutations (single nucleotide changes)
- Insertions or deletions
- Chromosomal rearrangements`,
    content_hash: randomUUID().replace(/-/g, ''),
  },
];

const graphNodes = [
  { id: id(), name: 'Cell Membrane', definition: 'Biological membrane separating the interior of cells from the outside environment. Composed of a lipid bilayer with embedded proteins.' },
  { id: id(), name: 'Mitochondria', definition: 'Membrane-bound organelles that generate ATP through cellular respiration. Known as the powerhouse of the cell.' },
  { id: id(), name: 'Ribosomes', definition: 'Molecular machines responsible for protein synthesis. Link amino acids in the order specified by mRNA.' },
  { id: id(), name: 'Photosynthesis', definition: 'Process by which plants convert light energy into chemical energy, producing glucose and oxygen from CO2 and water.' },
  { id: id(), name: 'Chloroplasts', definition: 'Organelles in plant cells where photosynthesis occurs. Contains thylakoid membrane and stroma.' },
  { id: id(), name: 'DNA', definition: 'Deoxyribonucleic acid — the molecule that carries genetic instructions for all living organisms.' },
  { id: id(), name: 'Mendelian Inheritance', definition: 'Laws of inheritance established by Gregor Mendel describing how traits are passed from parents to offspring.' },
  { id: id(), name: 'Calvin Cycle', definition: 'The carbon fixation stage of photosynthesis, occurring in the stroma of chloroplasts.' },
];

const flashcards = [
  { id: id(), front: 'What is the primary function of the cell membrane?', back: 'The cell membrane protects the cell, controls what enters and leaves, and facilitates cell signaling and communication.', card_type: 'qa' },
  { id: id(), front: 'Why are mitochondria called the powerhouse of the cell?', back: 'Mitochondria generate most of the cell\'s ATP (adenosine triphosphate) through cellular respiration, providing chemical energy for cellular processes.', card_type: 'qa' },
  { id: id(), front: 'What is the role of ribosomes?', back: 'Ribosomes are the site of protein synthesis — they link amino acids together in the order specified by mRNA molecules.', card_type: 'qa' },
  { id: id(), front: 'What are the products of photosynthesis?', back: 'Glucose (C6H12O6) and oxygen (O2). Plants use light energy, CO2, and water to produce these.', card_type: 'qa' },
  { id: id(), front: 'Where do the light-dependent reactions of photosynthesis occur?', back: 'In the thylakoid membrane of chloroplasts. They produce ATP and NADPH while splitting water molecules.', card_type: 'qa' },
  { id: id(), front: 'What is {{c1::DNA}}?', back: 'Deoxyribonucleic acid — the molecule that carries genetic instructions for the development, functioning, and reproduction of all known organisms.', card_type: 'cloze' },
  { id: id(), front: 'What is Mendel\'s Law of Segregation?', back: 'Each individual has two alleles for each gene, and these alleles separate (segregate) during gamete formation, so each gamete carries only one allele.', card_type: 'qa' },
  { id: id(), front: 'What are the two main stages of photosynthesis?', back: '1) Light-dependent reactions (in thylakoid membrane) 2) Calvin Cycle (in stroma). The first produces ATP/NADPH, the second fixes carbon into glucose.', card_type: 'qa' },
];

async function seed() {
  console.log('🌱 Seeding Supabase database...\n');

  // 1. Create user with proper password hash
  const passwordHash = hashPassword('password123');
  await sql`INSERT INTO users (id, email, name, password_hash, created_at) VALUES (${USER_ID}, 'student@example.com', 'Alex Chen', ${passwordHash}, ${now()}) ON CONFLICT (email) DO NOTHING`;
  console.log('✅ User created: student@example.com / password123');

  // 2. Create subject
  await sql`INSERT INTO subjects (id, user_id, name, description, created_at, archived) VALUES (${SUBJECT_ID}, ${USER_ID}, 'Biology 101', 'Fundamentals of biology covering cells, genetics, and photosynthesis', ${now()}, FALSE)`;
  console.log(`✅ Subject created: Biology 101 (${SUBJECT_ID})`);

  // 3. Create notes with versions
  for (const note of notes) {
    await sql`INSERT INTO note_files (id, subject_id, filename, content_hash, source, created_at, updated_at) VALUES (${note.id}, ${SUBJECT_ID}, ${note.filename}, ${note.content_hash}, 'upload', ${now()}, ${now()})`;
    await sql`INSERT INTO note_versions (id, note_file_id, content, created_at) VALUES (${id()}, ${note.id}, ${note.content}, ${now()})`;
    console.log(`✅ Note created: ${note.filename}`);
  }

  // 4. Create graph nodes
  for (const node of graphNodes) {
    await sql`INSERT INTO graph_nodes (id, subject_id, name, definition, reference_count, manually_edited, created_at, updated_at) VALUES (${node.id}, ${SUBJECT_ID}, ${node.name}, ${node.definition}, 1, FALSE, ${now()}, ${now()})`;
  }
  console.log(`✅ Graph nodes created: ${graphNodes.length}`);

  // 5. Create graph edges
  const edges = [
    { from: graphNodes[0], to: graphNodes[1], type: 'contains' },
    { from: graphNodes[0], to: graphNodes[2], type: 'contains' },
    { from: graphNodes[3], to: graphNodes[4], type: 'occurs_in' },
    { from: graphNodes[3], to: graphNodes[7], type: 'has_stage' },
    { from: graphNodes[5], to: graphNodes[6], type: 'governs' },
    { from: graphNodes[1], to: graphNodes[3], type: 'related_to' },
  ];

  for (const edge of edges) {
    await sql`INSERT INTO graph_edges (id, subject_id, from_node_id, to_node_id, relationship_type, created_at) VALUES (${id()}, ${SUBJECT_ID}, ${edge.from.id}, ${edge.to.id}, ${edge.type}, ${now()})`;
  }
  console.log(`✅ Graph edges created: ${edges.length}`);

  // 6. Create flashcards
  for (const card of flashcards) {
    await sql`INSERT INTO flashcards (id, subject_id, note_file_id, node_ids, front, back, card_type, status, created_at, updated_at, next_review_at, interval, ease_factor, review_count) VALUES (${card.id}, ${SUBJECT_ID}, ${notes[0].id}, '[]', ${card.front}, ${card.back}, ${card.card_type}, 'new', ${now()}, ${now()}, NULL, 1, 2.5, 0)`;
  }
  console.log(`✅ Flashcards created: ${flashcards.length}`);

  // 7. Link notes to graph nodes
  const noteNodeMap = [
    { node_id: graphNodes[0].id, note_id: notes[0].id },
    { node_id: graphNodes[1].id, note_id: notes[0].id },
    { node_id: graphNodes[2].id, note_id: notes[0].id },
    { node_id: graphNodes[3].id, note_id: notes[1].id },
    { node_id: graphNodes[4].id, note_id: notes[1].id },
    { node_id: graphNodes[7].id, note_id: notes[1].id },
    { node_id: graphNodes[5].id, note_id: notes[2].id },
    { node_id: graphNodes[6].id, note_id: notes[2].id },
  ];

  for (const mapping of noteNodeMap) {
    await sql`INSERT INTO node_note_map (node_id, note_file_id) VALUES (${mapping.node_id}, ${mapping.note_id}) ON CONFLICT DO NOTHING`;
  }
  console.log(`✅ Note-node mappings created: ${noteNodeMap.length}`);

  console.log('\n🎉 Database seeded successfully!');
  console.log(`\n   Login: student@example.com / password123`);
  console.log(`   Subject ID: ${SUBJECT_ID}`);
  console.log(`   Note IDs: ${notes.map(n => `${n.filename}=${n.id}`).join(', ')}`);

  await sql.end();
}

seed().catch(console.error);
