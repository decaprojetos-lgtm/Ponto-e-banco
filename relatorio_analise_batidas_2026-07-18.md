# Relatório de análise das batidas de ponto

Data da análise: 18/07/2026  
Período com registros: 11/02/2026 a 18/07/2026  
Escopo: consulta somente leitura; nenhum dado do banco foi alterado.

## Resumo executivo

O painel apresentou saldo líquido CLT de aproximadamente **-333h51m**. Até o dia anterior, o saldo calculado era **-330h04m**.

A principal causa é a regra que desconta a jornada completa de todo dia programado sem lançamento `WORK`. Isso acontece mesmo quando há uma entrada, almoço ou outra batida registrada, mas o funcionário não concluiu a saída. O sistema também presume trabalho em seis dias da semana, salvo justificativa cadastrada.

Foram localizados:

- 438 registros de ponto e 557 lançamentos no banco de horas.
- 153 dias programados sem registro `WORK` ou justificativa, equivalentes a 1.032 horas de débito potencial.
- 94 ajustes manuais positivos, totalizando 625h13m, usados em grande parte para compensar dias e batidas ausentes.
- Dois grupos de registros de ponto duplicados.
- Quatro grupos de lançamentos `WORK` duplicados.
- Onze datas com registros incompletos ou fora de ordem, sem contar as duplicações individuais do mesmo dia.
- Nenhuma divergência matemática entre uma batida encerrada válida e seu lançamento `WORK` único. O cálculo básico funciona quando o fluxo é concluído corretamente.

## Impacto por funcionário até 17/07/2026

| Funcionário | Dias programados sem WORK/abono | Débito potencial | Ajustes manuais | Saldo calculado |
|---|---:|---:|---:|---:|
| Douglas | 35 | 256h00 | +125h24 | -160h01 |
| Luana | 11 | 80h00 | +00h00 | -82h37 |
| Matheus | 53 | 360h00 | +309h20 | +16h55 |
| Patrícia | 36 | 216h00 | +122h17 | -51h45 |
| Roberto | 18 | 120h00 | +68h12 | -52h36 |

Esses dias precisam ser conferidos com a escala real. Parte pode ser esquecimento de ponto; parte pode ser folga, início de contrato incorreto, trabalho externo ou ausência que não foi cadastrada.

## Registros incompletos ou fora de ordem

| Funcionário | Data | Problema observado |
|---|---|---|
| Matheus | 18/02/2026 | Sem saída; última batida 15:00 |
| Roberto | 24/04/2026 | Sem saída; última batida 17:00 |
| Roberto | 18/05/2026 | Sem saída; horários repetidos às 16:11 |
| Patrícia | 03/06/2026 | Sem saída; última batida 16:10 |
| Patrícia | 08/06/2026 | Sem saída; última batida 14:42 |
| Luana | 17/06/2026 | Sem saída; última batida 16:26 |
| Douglas | 18/06/2026 | Sem saída; última batida 15:07 |
| Luana | 26/06/2026 | Sem saída; última batida 16:50 |
| Matheus | 28/06/2026 | Batidas fora de ordem: almoço 17:33 → 17:22 e saída 17:33 |
| Matheus | 08/07/2026 | Sem saída; retorno do almoço às 18:10 |
| Matheus | 09/07/2026 | Apenas entrada às 09:42 |

Registros curtos que exigem confirmação:

- Patrícia em 01/06/2026: 2h43 calculadas em dia de jornada cheia.
- Patrícia em 16/07/2026: 30 minutos calculados em dia de jornada cheia.

## Duplicações encontradas

### Registros de ponto

- Douglas em 28/06/2026: seis registros iniciados às 17:34.
- Matheus em 18/07/2026: dois registros iniciados às 09:20.

### Lançamentos WORK no banco de horas

- Matheus em 05/03/2026: dois lançamentos de +2 minutos.
- Douglas em 02/04/2026: quatro lançamentos de +7 minutos.
- Roberto em 11/04/2026: dois lançamentos de -9 minutos.
- Matheus em 28/06/2026: quatro lançamentos de +480 minutos.

O aplicativo costuma usar apenas o primeiro lançamento encontrado para calcular a tela. Mesmo assim, as duplicações deixam o banco inconsistente e podem afetar migrações e relatórios futuros.

## Causa técnica

1. Um dia passado sem lançamento `WORK` perde automaticamente toda a meta diária.
2. Um registro incompleto não gera `WORK`; portanto, as horas já registradas são ignoradas no saldo.
3. Ajustes manuais são usados para substituir batidas, misturando correção de ponto com crédito administrativo.
4. Não existem proteções suficientes contra dois registros do mesmo funcionário na mesma data.
5. As gravações do ponto e do banco de horas não são uma única operação atômica no banco.
6. O modelo de escala possui apenas jornada normal e um “dia curto”; ele não representa toda a escala real, folgas variáveis ou trabalho externo.

## Ajustes recomendados antes da migração

1. Confirmar a data real de início e a escala semanal de cada funcionário.
2. Corrigir os onze dias incompletos usando os horários verdadeiros.
3. Criar a função “Incluir ponto esquecido” para dias sem nenhum registro.
4. Separar “correção de batida” de “ajuste administrativo de saldo”.
5. Revisar os 153 dias sem `WORK`, classificando cada um como trabalho esquecido, folga, ausência, férias, feriado ou trabalho externo.
6. Remover duplicações somente depois de gerar backup e confirmar qual registro deve permanecer.
7. Na migração, criar restrição única para um registro por funcionário/data e um único lançamento `WORK` por funcionário/data.
8. Gravar registro e saldo por uma função transacional no banco, evitando atualizações pela metade.
9. Não migrar o saldo líquido atual como verdade contábil antes dessas conferências.

## Alterações já preparadas no aplicativo

- Edição dos seis horários pelo relatório.
- Validação da ordem das batidas e dos pares de intervalo.
- Recálculo do lançamento `WORK` após a correção.
- Verificação dos erros retornados pelo Supabase.
- Bloqueio de cliques repetidos durante uma batida.
- Inclusão administrativa de um ponto totalmente esquecido, com os mesmos controles de ordem e recálculo usados na edição.

Ainda falta implementar a revisão assistida dos dias pendentes e as proteções de unicidade no banco de dados.

## Escalas confirmadas com a gestão

### Regra geral de domingos

- A loja não abre todos os domingos.
- Domingo é folga por padrão para todos os funcionários.
- Quando houver abertura excepcional, apenas os funcionários escalados registram o ponto.
- Cada funcionário que trabalhar no domingo recebe uma folga compensatória de 8h em outro dia da semana.
- O dia da folga compensatória é variável e deve ser informado pela gestão.
- Um domingo sem batida não deve gerar débito; um dia útil usado como compensação não deve ser tratado como falta.

### Douglas

- Segunda-feira (semana inglesa): 10:00 às 14:00, meta de 4h.
- Terça-feira a sábado: meta diária de 8h.
- Domingo e folgas compensatórias seguem a regra geral da loja.
- Férias: 01/07/2026 a 30/07/2026 (30 dias), com retorno previsto em 31/07/2026.

Impacto esperado na revisão:

- Os débitos automáticos atribuídos ao Douglas durante as férias de julho não são faltas e devem ser neutralizados como férias.
- A meta atual das segundas-feiras, de 240 minutos, está correta.
- Domingos trabalhados e suas respectivas folgas compensatórias precisam ser vinculados para não gerar crédito e débito indevidos.

### Luana

- Início: 01/06/2026.
- Segunda, terça, quarta, sexta e sábado: meta diária de 8h.
- Quinta-feira (semana inglesa): meta de 4h.
- Domingo e folgas compensatórias seguem a regra geral da loja.
- Nenhuma férias, afastamento ou alteração especial foi informada para o período.

### Matheus

- Início: 02/02/2026.
- Segunda a sexta-feira: meta diária de 8h.
- Sábado (semana inglesa): meta de 4h.
- Domingo e folgas compensatórias seguem a regra geral da loja.
- A escala regular foi confirmada pela gestão.
- O saldo de horas extras precisa ser auditado antes de qualquer migração ou acerto.

Pontos obrigatórios da auditoria do Matheus:

- Revisar 40 ajustes manuais que somam aproximadamente +309h20.
- Conferir trabalhos externos e eventos registrados nas observações.
- Corrigir batidas incompletas em 18/02, 28/06, 08/07 e 09/07.
- Remover duplicações somente após backup: dois lançamentos WORK em 05/03, quatro lançamentos WORK em 28/06 e dois registros de ponto em 18/07.
- Relacionar cada domingo trabalhado à respectiva folga compensatória.

### Patrícia

- Início: 02/02/2026.
- Vínculo informado: estagiária.
- Segunda a sexta-feira: meta diária de 6h, limitada a 30h semanais.
- Sábado: folga.
- Domingo: folga padrão; eventual escala precisa preservar o limite de 30h na mesma semana.
- Não teve férias no período.
- Teve sete dias de afastamento com atestado médico; as datas ainda precisam ser informadas.
- O tratamento financeiro e de frequência desses sete dias está pendente de revisão do Termo de Compromisso de Estágio, das regras da instituição de ensino e do eventual agente integrador.

Observação jurídica para validação profissional:

- A Lei nº 11.788/2008 limita, em regra, o estágio de ensino superior, médio e profissional a 6h diárias e 30h semanais.
- A lei federal não disciplina expressamente, para toda empresa privada, o efeito do atestado médico sobre a bolsa-estágio.
- Normas de estágio da Administração Pública frequentemente tratam atestado de saúde como falta justificada sem compensação ou desconto, mas essas normas não vinculam automaticamente a empresa privada.
- Até conferir o contrato aplicável, os sete dias devem permanecer como “atestado em revisão”, sem correção definitiva do banco.

### Roberto

- Início: 02/02/2026.
- Segunda-feira (semana inglesa): 14:30 às 19:00, com intervalo de 30 minutos; meta líquida de 4h.
- Terça-feira a sábado: meta diária de 8h.
- Domingo e folgas compensatórias seguem a regra geral da loja.
- A escala regular foi confirmada pela gestão.
- Existe uma falta injustificada real de jornada cheia, com débito confirmado de 8h; a data ainda precisa ser identificada.

Impacto esperado na revisão:

- Preservar exatamente um débito de 8h referente à falta injustificada.
- Não validar automaticamente os demais dias sem `WORK` como faltas.
- Corrigir os registros incompletos de 24/04 e 18/05 antes do recálculo.
- Revisar o lançamento de 09/04 anotado como “Batida deletada”.
